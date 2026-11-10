import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  StorageConfig,
  UploadOptions,
  UploadResult,
  DownloadResult,
  PresignedUrlOptions,
  DeleteOptions,
  ObjectMetadataResult,
} from './types.js';

// ─── Constants & Defaults ──────────────────────────────────────────────────────

const DEFAULT_REGION = 'us-east-1';
const DEFAULT_EXPIRATION_SECONDS = 900; // 15 minutes
const MAX_EXPIRATION_SECONDS = 604800;  // 7 days (S3 maximum)
const MAX_KEY_LENGTH = 1024;

/** Characters strictly prohibited in S3 object keys to prevent path traversal and injection. */
const ILLEGAL_KEY_PATTERN = /[\0\r\n]|(\.\.\/)|(\.\.\\)/;

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

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Strip sensitive credentials or connection secrets from error messages before exposure. */
function sanitizeErrorMessage(msg: string): string {
  if (!msg) return 'Storage operation failed';
  return msg
    .replace(/(aws_secret_access_key|secretaccesskey|password|secret)=[^&\s]+/gi, '$1=[REDACTED]')
    .replace(/(minio_root_password)=[^&\s]+/gi, '$1=[REDACTED]');
}

/** Truncate and escape object key for safe logging. */
function sanitizeKeyForLog(key: string): string {
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
    buckets,
    cdnBaseUrl,
  };
}

// ─── S3 Storage Client ─────────────────────────────────────────────────────────

export class S3StorageClient {
  private readonly config: StorageConfig;
  private readonly s3Client: S3Client;

  constructor(configOverrides?: Partial<StorageConfig>, injectedS3Client?: S3Client) {
    this.config = resolveStorageConfig(configOverrides);

    if (injectedS3Client) {
      this.s3Client = injectedS3Client;
    } else {
      const clientConfig: S3ClientConfig = {
        region: this.config.region,
        forcePathStyle: this.config.forcePathStyle,
      };

      if (this.config.endpoint) {
        clientConfig.endpoint = this.config.endpoint;
      }

      if (this.config.accessKeyId && this.config.secretAccessKey) {
        clientConfig.credentials = {
          accessKeyId: this.config.accessKeyId,
          secretAccessKey: this.config.secretAccessKey,
        };
      }

      this.s3Client = new S3Client(clientConfig);
    }
  }

  /** Resolve bucket name from alias ('media' | 'kyc') or direct name. */
  private resolveBucket(bucketAliasOrName?: string): string {
    if (!bucketAliasOrName) return this.config.buckets.media;
    if (this.config.buckets[bucketAliasOrName]) {
      return this.config.buckets[bucketAliasOrName];
    }
    return bucketAliasOrName;
  }

  /**
   * Upload an object to S3 / MinIO.
   *
   * For KYC documents, sets isPrivate: true to ensure private ACL.
   */
  async upload(options: UploadOptions): Promise<UploadResult> {
    const key = validateObjectKey(options.key);
    const bucket = this.resolveBucket(options.bucket);
    const isPrivate = options.isPrivate ?? (bucket === this.config.buckets.kyc);

    const buffer = Buffer.isBuffer(options.body)
      ? options.body
      : typeof options.body === 'string'
        ? Buffer.from(options.body, 'utf-8')
        : Buffer.from(options.body);

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: options.contentType || 'application/octet-stream',
      Metadata: options.metadata,
      ...(isPrivate ? { ACL: 'private' } : {}),
    });

    try {
      await this.s3Client.send(command);

      const s3Uri = `s3://${bucket}/${key}`;
      let publicUrl: string;

      if (isPrivate) {
        // Private documents never return a direct public URL
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
        contentType: options.contentType,
        sizeBytes: buffer.length,
      };
    } catch (err: unknown) {
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

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    try {
      const response = await this.s3Client.send(command);
      if (!response.Body) {
        throw new StorageError('Empty body received from S3');
      }

      // Stream to buffer
      const stream = response.Body as NodeJS.ReadableStream;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);

      return {
        bucket,
        key,
        body,
        contentType: response.ContentType,
        contentLength: response.ContentLength ?? body.length,
        metadata: response.Metadata,
      };
    } catch (err: unknown) {
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

    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    try {
      await this.s3Client.send(command);
    } catch (err: unknown) {
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

    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    try {
      const response = await this.s3Client.send(command);
      return {
        bucket,
        key,
        sizeBytes: response.ContentLength ?? 0,
        contentType: response.ContentType,
        lastModified: response.LastModified,
        metadata: response.Metadata,
      };
    } catch (err: unknown) {
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

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    try {
      return await getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (err: unknown) {
      throw new StorageError(
        `Failed to generate presigned download URL [bucket=${bucket}, key=${sanitizeKeyForLog(key)}]: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Generate a time-limited presigned PUT URL for direct browser/client upload.
   */
  async getPresignedUploadUrl(options: PresignedUrlOptions): Promise<string> {
    const key = validateObjectKey(options.key);
    const bucket = this.resolveBucket(options.bucket);
    const expiresIn = Math.min(
      Math.max(options.expiresInSeconds ?? DEFAULT_EXPIRATION_SECONDS, 1),
      MAX_EXPIRATION_SECONDS,
    );
    const isPrivate = bucket === this.config.buckets.kyc;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: options.contentType,
      ...(isPrivate ? { ACL: 'private' } : {}),
    });

    try {
      return await getSignedUrl(this.s3Client, command, { expiresIn });
    } catch (err: unknown) {
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
