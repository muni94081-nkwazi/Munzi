// ─── Shared Storage Types — MUNZI Platform ─────────────────────────────────────
//
// Common contracts for object storage (S3-compatible: MinIO in dev, AWS S3 / Cloudflare R2 in prod).
// Designed for both media (publicly viewable via CDN or direct URL) and sensitive documents
// (strictly private KYC records, passports, tax filings accessible only via short-lived presigned URLs).

export interface StorageConfig {
  /** S3 endpoint (e.g. http://localhost:9000 for MinIO). Leave undefined for standard AWS S3. */
  endpoint?: string;
  /** AWS Region (default: 'us-east-1'). */
  region?: string;
  /** S3 Access Key ID (e.g. MinIO Root User or IAM Key ID). */
  accessKeyId?: string;
  /** S3 Secret Access Key (e.g. MinIO Root Password or IAM Secret). */
  secretAccessKey?: string;
  /** Whether to use SSL/HTTPS (default: false for localhost/minio, true for prod S3). */
  useSSL?: boolean;
  /** Whether to force path-style URLs (required for MinIO: true; optional for AWS: false). */
  forcePathStyle?: boolean;
  /** Named buckets managed by the platform. */
  buckets: {
    media: string;
    kyc: string;
    [key: string]: string;
  };
  /** Base CDN URL for public assets if configured. */
  cdnBaseUrl?: string;
}

export interface UploadOptions {
  /** Target bucket name or bucket alias ('media' | 'kyc'). Defaults to 'media'. */
  bucket?: string;
  /** Object key (path inside bucket, e.g. 'products/item-123.webp' or 'sellers/usr-456/id.pdf'). */
  key: string;
  /** File content payload. */
  body: Buffer | Uint8Array | string;
  /** MIME type (e.g. 'image/webp', 'application/pdf'). */
  contentType?: string;
  /** Optional metadata tags. */
  metadata?: Record<string, string>;
  /** Whether the object should be strictly private (true for KYC docs, default: false). */
  isPrivate?: boolean;
}

export interface UploadResult {
  bucket: string;
  key: string;
  /** Canonical S3 URI: s3://<bucket>/<key> */
  s3Uri: string;
  /** Public URL (if public/CDN supported) or s3Uri. */
  url: string;
  contentType?: string;
  sizeBytes: number;
}

export interface DownloadResult {
  bucket: string;
  key: string;
  body: Buffer;
  contentType?: string;
  contentLength?: number;
  metadata?: Record<string, string>;
}

export interface PresignedUrlOptions {
  /** Target bucket name or bucket alias ('media' | 'kyc'). Defaults to 'media'. */
  bucket?: string;
  /** Object key. */
  key: string;
  /** Lifetime of the presigned URL in seconds (default: 900 seconds / 15 minutes). */
  expiresInSeconds?: number;
  /** Content type expected on upload (for PUT presigned URLs). */
  contentType?: string;
}

export interface DeleteOptions {
  bucket?: string;
  key: string;
}

export interface ObjectMetadataResult {
  bucket: string;
  key: string;
  sizeBytes: number;
  contentType?: string;
  lastModified?: Date;
  metadata?: Record<string, string>;
}
