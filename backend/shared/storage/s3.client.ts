// ─── S3 Storage Client — MUNZI Platform ───────────────────────────────────────
//
// Shared, production-ready storage client supporting:
//   - Local development with MinIO (custom endpoint, path-style addressing)
//   - Production with AWS S3 / Cloudflare R2 / DigitalOcean Spaces
//   - Public media buckets (munzi-media) vs strictly private KYC buckets (munzi-kyc)
//   - Presigned upload & download URLs
//   - Object key validation & path-traversal prevention
//   - Credential sanitization in error logs
//   - Lazy SDK loading & dependency injection for deterministic offline unit testing

import type {
  StorageConfig,
  UploadOptions,
  UploadResult,
  DownloadResult,
  PresignedUrlOptions,
  DeleteOptions,
  ObjectMetadataResult,
  AllowedKycMimeType,
  AllowedPublicMediaNamespace,
  AllowedPublicMediaMimeType,
  KycValidationResult,
} from './types.js';

// ─── Constants & Defaults ──────────────────────────────────────────────────────

const DEFAULT_REGION = 'us-east-1';
const DEFAULT_EXPIRATION_SECONDS = 900; // 15 minutes
const MAX_EXPIRATION_SECONDS = 604800;  // 7 days (S3 maximum)
const MAX_KEY_LENGTH = 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_KYC_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB

/** Allowed MIME types for KYC identity documents. */
export const ALLOWED_KYC_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

/** Allowed key namespaces (prefixes) for public media assets. */
export const ALLOWED_PUBLIC_MEDIA_NAMESPACES = [
  'products/',
  'banners/',
  'categories/',
  'avatars/',
] as const;

/** Allowed MIME types for public media assets (strictly images and approved web video). */
export const ALLOWED_PUBLIC_MEDIA_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
] as const;

/** Signatures/magic bytes strictly prohibited in public media bucket (documents, executables, scripts). */
const PROHIBITED_MEDIA_SIGNATURES = [
  { name: 'PDF document', bytes: [0x25, 0x50, 0x44, 0x46] },          // %PDF
  { name: 'ZIP / Office archive', bytes: [0x50, 0x4b, 0x03, 0x04] },   // PK..
  { name: 'Windows executable', bytes: [0x4d, 0x5a] },                 // MZ
  { name: 'ELF executable', bytes: [0x7f, 0x45, 0x4c, 0x46] },         // .ELF
];

/** Characters strictly prohibited in S3 object keys to prevent path traversal and injection. */
const ILLEGAL_KEY_PATTERN = /[\0\r\n]|(\.\.\/)|(\.\.\\)/;

/**
 * Pattern matching file keys resembling sensitive documents (KYC, passports, national IDs, tax returns).
 * Used to enforce strict bucket segregation and keep private documents out of public media storage.
 */
export const SENSITIVE_DOCUMENT_PATTERN =
  /(?:^|\/|_|-)(?:kyc|passport|national[-_]?id|id[-_]?card|tax[-_]?id|tax[-_]?return|drivers?[-_]?licen[sc]e|bank[-_]?statement|ssn|identity|voter[-_]?card|birth[-_]?certificate)(?:$|\/|\.|_|-)/i;

// ─── Custom Errors ─────────────────────────────────────────────────────────────

export class StorageError extends Error {
  readonly status: number;
  constructor(message: string, status = 500) {
    super(sanitizeErrorMessage(message));
    this.name = 'StorageError';
    this.status = status;
  }
}

export class InvalidObjectKeyError extends StorageError {
  constructor(key: string, reason: string) {
    super(`Invalid object key "${sanitizeKeyForLog(key)}": ${reason}`, 400);
    this.name = 'InvalidObjectKeyError';
  }
}

export class StorageNotFoundError extends StorageError {
  constructor(bucket: string, key: string) {
    super(`Object "${sanitizeKeyForLog(key)}" not found in bucket "${bucket}"`, 404);
    this.name = 'StorageNotFoundError';
  }
}

export class StorageValidationError extends StorageError {
  constructor(reason: string) {
    super(`Storage validation failed: ${reason}`, 400);
    this.name = 'StorageValidationError';
  }
}

export class StorageTimeoutError extends StorageError {
  constructor(operation: string, timeoutMs: number) {
    super(`Storage operation "${operation}" timed out after ${timeoutMs}ms`, 504);
    this.name = 'StorageTimeoutError';
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Check whether an object key indicates a sensitive personal or KYC document. */
export function isSensitiveDocumentKey(key: string): boolean {
  if (!key) return false;
  return SENSITIVE_DOCUMENT_PATTERN.test(key);
}

/**
 * Validate public media upload constraints:
 *   1. Explicit isPublicMedia: true declaration
 *   2. Key namespace restricted to approved public prefixes (products/, banners/, categories/, avatars/)
 *   3. MIME type restricted to approved public media (image/jpeg, image/png, image/webp, video/mp4)
 *   4. Rejection of prohibited file signatures (PDF, ZIP, EXE, ELF)
 *   5. Rejection of HTML/SVG markup to prevent stored XSS attacks
 */
export function validatePublicMediaUpload(options: {
  key: string;
  contentType?: string;
  isPublicMedia?: boolean;
  bodyBuffer?: Buffer;
}): void {
  // 1. Explicit declaration required
  if (options.isPublicMedia !== true) {
    throw new StorageValidationError(
      'Uploads to public media bucket "munzi-media" require an explicit "isPublicMedia: true" declaration. Missing or false declarations are strictly rejected.',
    );
  }

  // 2. Key must reside in an approved public namespace
  const hasValidNamespace = ALLOWED_PUBLIC_MEDIA_NAMESPACES.some((ns) =>
    options.key.startsWith(ns),
  );
  if (!hasValidNamespace) {
    throw new StorageValidationError(
      `Object key "${sanitizeKeyForLog(options.key)}" is outside approved public media namespaces. Allowed namespaces: ${ALLOWED_PUBLIC_MEDIA_NAMESPACES.join(', ')}.`,
    );
  }

  // 3. Heuristic sensitive document pattern check
  if (isSensitiveDocumentKey(options.key)) {
    throw new StorageValidationError(
      `Object key "${sanitizeKeyForLog(options.key)}" resembles a sensitive KYC or identity document. Sensitive documents must not be stored in the public media bucket. Use the private KYC bucket instead.`,
    );
  }

  // 4. Content-Type must be explicitly declared and belong to allowed media types
  if (!options.contentType) {
    throw new StorageValidationError(
      'Content-Type must be explicitly declared for public media uploads.',
    );
  }
  const normalizedMime = options.contentType.toLowerCase().split(';')[0].trim();
  const isAllowedMime =
    ALLOWED_PUBLIC_MEDIA_MIME_TYPES.includes(normalizedMime as any) ||
    normalizedMime === 'image/jpg';

  if (!isAllowedMime) {
    throw new StorageValidationError(
      `Content-Type "${options.contentType}" is not permitted in public media. Allowed MIME types: ${ALLOWED_PUBLIC_MEDIA_MIME_TYPES.join(', ')}. Documents (PDF, SVG, HTML, scripts, archives) are strictly prohibited in public media.`,
    );
  }

  // 5. Deep inspection of payload body (if buffer provided)
  if (options.bodyBuffer && options.bodyBuffer.length >= 2) {
    for (const sig of PROHIBITED_MEDIA_SIGNATURES) {
      if (options.bodyBuffer.length < sig.bytes.length) continue;
      let match = true;
      for (let i = 0; i < sig.bytes.length; i++) {
        if (options.bodyBuffer[i] !== sig.bytes[i]) {
          match = false;
          break;
        }
      }
      if (match) {
        throw new StorageValidationError(
          `Payload contains prohibited content signature (${sig.name}). Documents and executables must never be stored in the public media bucket.`,
        );
      }
    }

    // Check first 256 bytes for HTML/SVG markup
    const preview = options.bodyBuffer.slice(0, 256).toString('utf-8').toLowerCase();
    if (
      preview.includes('<svg') ||
      preview.includes('<html') ||
      preview.includes('<!doctype') ||
      preview.includes('<script')
    ) {
      throw new StorageValidationError(
        'Payload contains HTML/SVG script markup. SVG and HTML are prohibited in public media to prevent stored XSS attacks.',
      );
    }
  }
}

/**
 * Inspect file magic bytes/signatures to verify file type independently of declared MIME types.
 * Supported signatures:
 *   - PDF: %PDF (0x25 0x50 0x44 0x46)
 *   - JPEG: FF D8 FF
 *   - PNG: 89 50 4E 47 0D 0A 1A 0A
 */
export function detectFileSignature(buffer: Buffer): 'pdf' | 'jpeg' | 'png' | null {
  if (!buffer || buffer.length < 4) {
    return null;
  }

  // PDF signature: %PDF (0x25, 0x50, 0x44, 0x46)
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return 'pdf';
  }

  // JPEG signature: FF D8 FF
  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'jpeg';
  }

  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png';
  }

  return null;
}

/**
 * Validate KYC document payload against file content signature (magic bytes) and MIME declarations.
 * Restricts uploads strictly to PDF, JPEG, and PNG.
 */
export function validateKycDocument(
  buffer: Buffer,
  declaredContentType?: string,
): KycValidationResult {
  if (!buffer || buffer.length === 0) {
    throw new StorageValidationError('KYC document payload is empty');
  }

  if (buffer.length < 4) {
    throw new StorageValidationError('KYC document payload is too small to contain a valid file header');
  }

  if (buffer.length > MAX_KYC_FILE_SIZE_BYTES) {
    throw new StorageValidationError(
      `KYC document exceeds maximum allowed size of 15MB (${(buffer.length / (1024 * 1024)).toFixed(2)}MB)`,
    );
  }

  const detected = detectFileSignature(buffer);
  if (!detected) {
    throw new StorageValidationError(
      'Invalid KYC document format. Only PDF, JPEG, and PNG files with valid file signatures are permitted.',
    );
  }

  const formatToMime: Record<'pdf' | 'jpeg' | 'png', AllowedKycMimeType> = {
    pdf: 'application/pdf',
    jpeg: 'image/jpeg',
    png: 'image/png',
  };

  const verifiedMime = formatToMime[detected];

  if (declaredContentType) {
    const normalizedDeclared = declaredContentType.toLowerCase().split(';')[0].trim();
    const isDeclaredJpeg = (detected === 'jpeg' && (normalizedDeclared === 'image/jpeg' || normalizedDeclared === 'image/jpg'));
    const isDeclaredPdf = (detected === 'pdf' && normalizedDeclared === 'application/pdf');
    const isDeclaredPng = (detected === 'png' && normalizedDeclared === 'image/png');

    if (!isDeclaredJpeg && !isDeclaredPdf && !isDeclaredPng) {
      throw new StorageValidationError(
        `Declared Content-Type "${declaredContentType}" does not match verified file signature ("${verifiedMime}").`,
      );
    }
  }

  return {
    isValid: true,
    detectedFormat: detected,
    mimeType: verifiedMime,
    fileSizeBytes: buffer.length,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Strip sensitive credentials or connection secrets from error messages before exposure. */
export function sanitizeErrorMessage(msg: string): string {
  if (!msg) return 'Storage operation failed';
  return msg
    .replace(/(aws_secret_access_key|secretaccesskey|password|secret)=[^&\s]+/gi, '$1=[REDACTED]')
    .replace(/(minio_root_password)=[^&\s]+/gi, '$1=[REDACTED]');
}

/** Truncate and escape object key for safe logging. */
export function sanitizeKeyForLog(key: string): string {
  if (!key) return '';
  const clean = key.replace(/[\0\r\n]/g, '');
  return clean.length > 80 ? `${clean.slice(0, 77)}...` : clean;
}

/** Validate object key against path traversal, length, and prohibited characters. */
export function validateObjectKey(key: string): string {
  if (!key || typeof key !== 'string') {
    throw new InvalidObjectKeyError('', 'Object key must be a non-empty string');
  }

  const trimmed = key.trim();
  if (trimmed.length === 0) {
    throw new InvalidObjectKeyError(key, 'Object key cannot be empty or whitespace');
  }

  if (trimmed.length > MAX_KEY_LENGTH) {
    throw new InvalidObjectKeyError(trimmed, `Object key exceeds maximum length of ${MAX_KEY_LENGTH} characters`);
  }

  if (ILLEGAL_KEY_PATTERN.test(trimmed)) {
    throw new InvalidObjectKeyError(trimmed, 'Object key contains forbidden path traversal or control characters');
  }

  // Remove leading slashes to prevent root-relative key mismatches
  return trimmed.replace(/^\/+/, '');
}

/** Resolve storage configuration from explicit options or process environment variables. */
export function resolveStorageConfig(overrides?: Partial<StorageConfig>): StorageConfig {
  const endpoint = overrides?.endpoint ?? process.env.S3_ENDPOINT;
  const region = overrides?.region ?? process.env.S3_REGION ?? process.env.AWS_REGION ?? DEFAULT_REGION;
  const accessKeyId = overrides?.accessKeyId ?? process.env.S3_ACCESS_KEY ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = overrides?.secretAccessKey ?? process.env.S3_SECRET_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
  const useSSL = overrides?.useSSL ?? (process.env.S3_USE_SSL === 'true');

  // Force path style is required for MinIO or when an explicit custom endpoint is provided
  const forcePathStyle = overrides?.forcePathStyle ?? (
    process.env.S3_FORCE_PATH_STYLE === 'true' || Boolean(endpoint)
  );

  const requestTimeoutMs = overrides?.requestTimeoutMs ?? (
    process.env.S3_REQUEST_TIMEOUT_MS ? parseInt(process.env.S3_REQUEST_TIMEOUT_MS, 10) : DEFAULT_REQUEST_TIMEOUT_MS
  );

  const maxRetries = overrides?.maxRetries ?? (
    process.env.S3_MAX_RETRIES ? parseInt(process.env.S3_MAX_RETRIES, 10) : DEFAULT_MAX_RETRIES
  );

  const buckets = {
    media: overrides?.buckets?.media ?? process.env.S3_BUCKET_MEDIA ?? process.env.AWS_S3_BUCKET ?? 'munzi-media',
    kyc: overrides?.buckets?.kyc ?? process.env.S3_BUCKET_KYC ?? 'munzi-kyc',
    ...overrides?.buckets,
  };

  const cdnBaseUrl = overrides?.cdnBaseUrl ?? process.env.CDN_BASE_URL;

  return {
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    useSSL,
    forcePathStyle,
    requestTimeoutMs,
    maxRetries,
    buckets,
    cdnBaseUrl,
  };
}

// ─── SDK Loader & Mock Interface ───────────────────────────────────────────────

export interface S3ClientProtocol {
  send(command: any, options?: { abortSignal?: AbortSignal }): Promise<any>;
}

export interface AwsSdkBundle {
  S3Client: any;
  PutObjectCommand: any;
  GetObjectCommand: any;
  DeleteObjectCommand: any;
  HeadObjectCommand: any;
  getSignedUrl: (client: any, command: any, options: { expiresIn: number }) => Promise<string>;
  NodeHttpHandler?: any;
}

let cachedSdk: AwsSdkBundle | null = null;

async function loadAwsSdk(): Promise<AwsSdkBundle> {
  if (cachedSdk) return cachedSdk;
  try {
    const s3Module = await import('@aws-sdk/client-s3' as never) as any;
    const presignerModule = await import('@aws-sdk/s3-request-presigner' as never) as any;

    let NodeHttpHandler: any = null;
    try {
      const smithyModule = await import('@smithy/node-http-handler' as never) as any;
      NodeHttpHandler = smithyModule.NodeHttpHandler;
    } catch {
      try {
        const awsHandlerModule = await import('@aws-sdk/node-http-handler' as never) as any;
        NodeHttpHandler = awsHandlerModule.NodeHttpHandler;
      } catch {
        NodeHttpHandler = null;
      }
    }

    cachedSdk = {
      S3Client: s3Module.S3Client,
      PutObjectCommand: s3Module.PutObjectCommand,
      GetObjectCommand: s3Module.GetObjectCommand,
      DeleteObjectCommand: s3Module.DeleteObjectCommand,
      HeadObjectCommand: s3Module.HeadObjectCommand,
      getSignedUrl: presignerModule.getSignedUrl,
      NodeHttpHandler,
    };
    return cachedSdk;
  } catch (err: unknown) {
    throw new StorageError(
      'AWS S3 SDK (@aws-sdk/client-s3, @aws-sdk/s3-request-presigner) is not available in the current environment.',
      500,
    );
  }
}

// ─── S3 Storage Client ─────────────────────────────────────────────────────────

export class S3StorageClient {
  private readonly config: StorageConfig;
  private s3Client: S3ClientProtocol | null = null;
  private sdkBundle: AwsSdkBundle | null = null;

  constructor(
    configOverrides?: Partial<StorageConfig>,
    injectedClient?: S3ClientProtocol,
    injectedSdk?: AwsSdkBundle,
  ) {
    this.config = resolveStorageConfig(configOverrides);
    if (injectedClient) {
      this.s3Client = injectedClient;
    }
    if (injectedSdk) {
      this.sdkBundle = injectedSdk;
    }
  }

  /** Lazy-initialize the SDK bundle and S3Client. */
  private async getSdkAndClient(): Promise<{ client: S3ClientProtocol; sdk: AwsSdkBundle }> {
    if (!this.sdkBundle) {
      this.sdkBundle = await loadAwsSdk();
    }

    if (!this.s3Client) {
      const timeoutMs = this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      const clientConfig: Record<string, unknown> = {
        region: this.config.region,
        forcePathStyle: this.config.forcePathStyle,
        // Standard idempotent retries: 1 initial attempt + maxRetries transient error retries
        maxAttempts: (this.config.maxRetries ?? DEFAULT_MAX_RETRIES) + 1,
      };

      // Real NodeHttpHandler instance for AWS SDK v3 connection & socket timeouts
      if (this.sdkBundle.NodeHttpHandler) {
        clientConfig.requestHandler = new this.sdkBundle.NodeHttpHandler({
          requestTimeout: timeoutMs,
          connectionTimeout: timeoutMs,
        });
      }

      if (this.config.endpoint) {
        clientConfig.endpoint = this.config.endpoint;
      }

      if (this.config.accessKeyId && this.config.secretAccessKey) {
        clientConfig.credentials = {
          accessKeyId: this.config.accessKeyId,
          secretAccessKey: this.config.secretAccessKey,
        };
      }

      this.s3Client = new this.sdkBundle.S3Client(clientConfig);
    }

    return { client: this.s3Client!, sdk: this.sdkBundle };
  }

  /** Resolve bucket name from alias ('media' | 'kyc') or direct name. */
  resolveBucket(bucketAliasOrName?: string): string {
    if (!bucketAliasOrName) return this.config.buckets.media;
    if (this.config.buckets[bucketAliasOrName]) {
      return this.config.buckets[bucketAliasOrName];
    }
    return bucketAliasOrName;
  }

  /**
   * Upload an object to S3 / MinIO.
   *
   * Enforces strict policies:
   *   - munzi-media: Requires explicit isPublicMedia: true, approved namespaces (products/, banners/, categories/, avatars/),
   *     and approved media MIME types (image/jpeg, image/png, image/webp, video/mp4). Documents & executables are rejected.
   *   - munzi-kyc: Strict magic-byte inspection (PDF, JPEG, PNG only). Strictly private (never exposes public URL).
   *   - Request timeouts & retries: Timeouts are enforced via NodeHttpHandler and per-request AbortSignal.
   *     Retries are safe & idempotent: S3 PutObject atomically replaces the exact object key.
   */
  async upload(options: UploadOptions): Promise<UploadResult> {
    const key = validateObjectKey(options.key);
    const bucket = this.resolveBucket(options.bucket);
    const isKycBucket = bucket === this.config.buckets.kyc;
    const isMediaBucket = bucket === this.config.buckets.media;

    const buffer = Buffer.isBuffer(options.body)
      ? options.body
      : typeof options.body === 'string'
        ? Buffer.from(options.body, 'utf-8')
        : Buffer.from(options.body);

    let contentType = options.contentType;

    // Strict KYC validation: disallow public media claims, enforce magic bytes, enforce private ACL
    if (isKycBucket) {
      if (options.isPublicMedia === true) {
        throw new StorageValidationError(
          'KYC documents can never be declared as public media. KYC records are strictly confidential.',
        );
      }
      const kycValidation = validateKycDocument(buffer, options.contentType);
      contentType = kycValidation.mimeType;
    }

    // Strict public media validation: requires isPublicMedia: true, allowed namespace, allowed MIME
    if (isMediaBucket) {
      if (options.isPrivate === true) {
        throw new StorageValidationError(
          `Private documents cannot be stored in the public media bucket "${bucket}". Use the private KYC bucket instead.`,
        );
      }
      validatePublicMediaUpload({
        key,
        contentType: options.contentType,
        isPublicMedia: options.isPublicMedia,
        bodyBuffer: buffer,
      });
    }

    // KYC bucket is unconditionally private; cannot be overridden to public
    const isPrivate = isKycBucket || (options.isPrivate === true);

    const { client, sdk } = await this.getSdkAndClient();

    const command = new sdk.PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
      Metadata: options.metadata,
      ...(isPrivate ? { ACL: 'private' } : {}),
    });

    const timeoutMs = this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const abortSignal = AbortSignal.timeout(timeoutMs);

    try {
      await client.send(command, { abortSignal });

      const s3Uri = `s3://${bucket}/${key}`;
      let publicUrl: string;

      if (isPrivate) {
        // Strictly private & KYC documents NEVER expose an HTTP/CDN public URL
        publicUrl = s3Uri;
      } else if (this.config.cdnBaseUrl) {
        publicUrl = `${this.config.cdnBaseUrl.replace(/\/+$/, '')}/${key}`;
      } else if (this.config.endpoint) {
        // MinIO / custom endpoint path-style URL
        publicUrl = `${this.config.endpoint.replace(/\/+$/, '')}/${bucket}/${key}`;
      } else {
        // Standard AWS S3 URL
        publicUrl = `https://${bucket}.s3.${this.config.region}.amazonaws.com/${key}`;
      }

      return {
        bucket,
        key,
        s3Uri,
        url: publicUrl,
        contentType,
        sizeBytes: buffer.length,
      };
    } catch (err: unknown) {
      if (err instanceof StorageError) throw err;
      if (abortSignal.aborted || (err as any).name === 'AbortError' || (err as any).name === 'TimeoutError') {
        throw new StorageTimeoutError('upload', timeoutMs);
      }
      throw new StorageError(
        `Failed to upload object to S3 [bucket=${bucket}, key=${sanitizeKeyForLog(key)}]: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Download an object from S3 / MinIO.
   */
  async download(bucketAliasOrName: string | undefined, rawKey: string): Promise<DownloadResult> {
    const key = validateObjectKey(rawKey);
    const bucket = this.resolveBucket(bucketAliasOrName);

    const { client, sdk } = await this.getSdkAndClient();
    const command = new sdk.GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const timeoutMs = this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const abortSignal = AbortSignal.timeout(timeoutMs);

    try {
      const response = await client.send(command, { abortSignal });
      if (!response.Body) {
        throw new StorageError('Empty body received from S3');
      }

      let body: Buffer;
      if (Buffer.isBuffer(response.Body)) {
        body = response.Body;
      } else if (typeof (response.Body as any)[Symbol.asyncIterator] === 'function') {
        const chunks: Buffer[] = [];
        for await (const chunk of response.Body as AsyncIterable<any>) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        body = Buffer.concat(chunks);
      } else {
        body = Buffer.from(response.Body);
      }

      return {
        bucket,
        key,
        body,
        contentType: response.ContentType,
        contentLength: response.ContentLength ?? body.length,
        metadata: response.Metadata,
      };
    } catch (err: unknown) {
      if (err instanceof StorageError) throw err;
      if (abortSignal.aborted || (err as any).name === 'AbortError' || (err as any).name === 'TimeoutError') {
        throw new StorageTimeoutError('download', timeoutMs);
      }
      const error = err as { name?: string; message: string; $metadata?: { httpStatusCode?: number } };
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        throw new StorageNotFoundError(bucket, key);
      }
      throw new StorageError(
        `Failed to download object from S3 [bucket=${bucket}, key=${sanitizeKeyForLog(key)}]: ${error.message}`,
        error.$metadata?.httpStatusCode || 500,
      );
    }
  }

  /**
   * Delete an object from S3 / MinIO.
   */
  async delete(options: DeleteOptions): Promise<void> {
    const key = validateObjectKey(options.key);
    const bucket = this.resolveBucket(options.bucket);

    const { client, sdk } = await this.getSdkAndClient();
    const command = new sdk.DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const timeoutMs = this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const abortSignal = AbortSignal.timeout(timeoutMs);

    try {
      await client.send(command, { abortSignal });
    } catch (err: unknown) {
      if (err instanceof StorageError) throw err;
      if (abortSignal.aborted || (err as any).name === 'AbortError' || (err as any).name === 'TimeoutError') {
        throw new StorageTimeoutError('delete', timeoutMs);
      }
      throw new StorageError(
        `Failed to delete object from S3 [bucket=${bucket}, key=${sanitizeKeyForLog(key)}]: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Retrieve object metadata (size, content type, last modified) without fetching body.
   */
  async getMetadata(bucketAliasOrName: string | undefined, rawKey: string): Promise<ObjectMetadataResult> {
    const key = validateObjectKey(rawKey);
    const bucket = this.resolveBucket(bucketAliasOrName);

    const { client, sdk } = await this.getSdkAndClient();
    const command = new sdk.HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const timeoutMs = this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const abortSignal = AbortSignal.timeout(timeoutMs);

    try {
      const response = await client.send(command, { abortSignal });
      return {
        bucket,
        key,
        sizeBytes: response.ContentLength ?? 0,
        contentType: response.ContentType,
        lastModified: response.LastModified,
        metadata: response.Metadata,
      };
    } catch (err: unknown) {
      if (err instanceof StorageError) throw err;
      if (abortSignal.aborted || (err as any).name === 'AbortError' || (err as any).name === 'TimeoutError') {
        throw new StorageTimeoutError('metadata', timeoutMs);
      }
      const error = err as { name?: string; message: string; $metadata?: { httpStatusCode?: number } };
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        throw new StorageNotFoundError(bucket, key);
      }
      throw new StorageError(
        `Failed to head object in S3 [bucket=${bucket}, key=${sanitizeKeyForLog(key)}]: ${error.message}`,
        error.$metadata?.httpStatusCode || 500,
      );
    }
  }

  /**
   * Generate a time-limited presigned GET URL for secure file download.
   */
  async getPresignedDownloadUrl(options: PresignedUrlOptions): Promise<string> {
    const key = validateObjectKey(options.key);
    const bucket = this.resolveBucket(options.bucket);
    const expiresIn = Math.min(
      Math.max(options.expiresInSeconds ?? DEFAULT_EXPIRATION_SECONDS, 1),
      MAX_EXPIRATION_SECONDS,
    );

    const { client, sdk } = await this.getSdkAndClient();
    const command = new sdk.GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    try {
      return await sdk.getSignedUrl(client, command, { expiresIn });
    } catch (err: unknown) {
      throw new StorageError(
        `Failed to generate presigned download URL [bucket=${bucket}, key=${sanitizeKeyForLog(key)}]: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Generate a time-limited presigned PUT URL for direct browser/client upload.
   *
   * Enforces strict policies:
   *   - munzi-media: Requires explicit isPublicMedia: true, approved namespaces (products/, banners/, categories/, avatars/),
   *     and approved media MIME types (image/jpeg, image/png, image/webp, video/mp4). Documents & executables are rejected.
   *   - munzi-kyc: Strictly validates declared Content-Type against allowed types (PDF, JPEG, PNG). Disallows isPublicMedia.
   */
  async getPresignedUploadUrl(options: PresignedUrlOptions): Promise<string> {
    const key = validateObjectKey(options.key);
    const bucket = this.resolveBucket(options.bucket);
    const isKycBucket = bucket === this.config.buckets.kyc;
    const isMediaBucket = bucket === this.config.buckets.media;

    // Strict public media validation for presigned upload URLs
    if (isMediaBucket) {
      validatePublicMediaUpload({
        key,
        contentType: options.contentType,
        isPublicMedia: options.isPublicMedia,
      });
    }

    // Require valid, allowed Content-Type for KYC presigned uploads; disallow isPublicMedia
    if (isKycBucket) {
      if (options.isPublicMedia === true) {
        throw new StorageValidationError('KYC documents can never be declared as public media.');
      }
      if (!options.contentType) {
        throw new StorageValidationError(
          'Content-Type must be explicitly specified when requesting a presigned KYC upload URL.',
        );
      }
      const normalized = options.contentType.toLowerCase().split(';')[0].trim();
      const isAllowedKycMime = (
        ALLOWED_KYC_MIME_TYPES.includes(normalized as any) || normalized === 'image/jpg'
      );
      if (!isAllowedKycMime) {
        throw new StorageValidationError(
          `Invalid Content-Type "${options.contentType}" for KYC upload. Allowed types: application/pdf, image/jpeg, image/png.`,
        );
      }
    }

    const expiresIn = Math.min(
      Math.max(options.expiresInSeconds ?? DEFAULT_EXPIRATION_SECONDS, 1),
      MAX_EXPIRATION_SECONDS,
    );
    const isPrivate = isKycBucket;

    const { client, sdk } = await this.getSdkAndClient();
    const command = new sdk.PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: options.contentType,
      ...(isPrivate ? { ACL: 'private' } : {}),
    });

    try {
      return await sdk.getSignedUrl(client, command, { expiresIn });
    } catch (err: unknown) {
      if (err instanceof StorageError) throw err;
      throw new StorageError(
        `Failed to generate presigned upload URL [bucket=${bucket}, key=${sanitizeKeyForLog(key)}]: ${(err as Error).message}`,
      );
    }
  }

  /** Expose resolved configuration (excluding secret keys) for diagnostics. */
  getConfigSummary(): Record<string, unknown> {
    return {
      endpoint: this.config.endpoint ?? 'AWS_DEFAULT',
      region: this.config.region,
      hasAccessKey: Boolean(this.config.accessKeyId),
      forcePathStyle: this.config.forcePathStyle,
      requestTimeoutMs: this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      maxRetries: this.config.maxRetries ?? DEFAULT_MAX_RETRIES,
      buckets: { ...this.config.buckets },
      cdnBaseUrl: this.config.cdnBaseUrl ?? 'NONE',
    };
  }
}

// ─── Singleton Factory ─────────────────────────────────────────────────────────

let defaultStorageClient: S3StorageClient | null = null;

export function getStorageClient(): S3StorageClient {
  if (!defaultStorageClient) {
    defaultStorageClient = new S3StorageClient();
  }
  return defaultStorageClient;
}
