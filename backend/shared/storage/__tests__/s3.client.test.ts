// ─── S3 Storage Client Unit Tests ─────────────────────────────────────────────
//
// Mock-based unit tests for MUNZI's S3StorageClient, KYC validation, timeout & retries,
// and media bucket access segregation. Executes offline with zero Docker dependencies.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateObjectKey,
  resolveStorageConfig,
  sanitizeErrorMessage,
  detectFileSignature,
  validateKycDocument,
  validatePublicMediaUpload,
  isSensitiveDocumentKey,
  S3StorageClient,
  InvalidObjectKeyError,
  StorageNotFoundError,
  StorageValidationError,
  StorageTimeoutError,
  StorageError,
  ALLOWED_KYC_MIME_TYPES,
  ALLOWED_PUBLIC_MEDIA_NAMESPACES,
  ALLOWED_PUBLIC_MEDIA_MIME_TYPES,
  type AwsSdkBundle,
  type S3ClientProtocol,
} from '../s3.client.ts';

// ─── Key Validation ────────────────────────────────────────────────────────────

describe('S3 Storage Client — Key Validation', () => {
  it('accepts clean, standard object keys', () => {
    assert.equal(validateObjectKey('products/item-1.webp'), 'products/item-1.webp');
    assert.equal(validateObjectKey('sellers/kyc/user-123/passport.pdf'), 'sellers/kyc/user-123/passport.pdf');
    assert.equal(validateObjectKey('banners/summer-banner.png'), 'banners/summer-banner.png');
  });

  it('strips leading slashes to prevent root-relative key mismatches', () => {
    assert.equal(validateObjectKey('/products/item-1.webp'), 'products/item-1.webp');
    assert.equal(validateObjectKey('///sellers/doc.pdf'), 'sellers/doc.pdf');
  });

  it('rejects path traversal attempts with ../ or ..\\', () => {
    assert.throws(() => validateObjectKey('../etc/passwd'), InvalidObjectKeyError);
    assert.throws(() => validateObjectKey('uploads/../../secret.key'), InvalidObjectKeyError);
    assert.throws(() => validateObjectKey('..\\windows\\system32'), InvalidObjectKeyError);
  });

  it('rejects null bytes and control characters', () => {
    assert.throws(() => validateObjectKey('file\0.jpg'), InvalidObjectKeyError);
    assert.throws(() => validateObjectKey('file\r\n.jpg'), InvalidObjectKeyError);
  });

  it('rejects empty or whitespace-only keys', () => {
    assert.throws(() => validateObjectKey(''), InvalidObjectKeyError);
    assert.throws(() => validateObjectKey('   '), InvalidObjectKeyError);
    assert.throws(() => validateObjectKey(null as any), InvalidObjectKeyError);
  });

  it('rejects keys exceeding maximum length (1024 chars)', () => {
    const longKey = 'a'.repeat(1025);
    assert.throws(() => validateObjectKey(longKey), InvalidObjectKeyError);
  });
});

// ─── Configuration Resolution, Timeouts & Retries ──────────────────────────────

describe('S3 Storage Client — Configuration, Timeouts & Retries', () => {
  it('resolves default config with 5000ms request timeout and 3 max retries', () => {
    const config = resolveStorageConfig({
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      accessKeyId: 'test_access',
      secretAccessKey: 'test_secret',
    });

    assert.equal(config.endpoint, 'http://localhost:9000');
    assert.equal(config.region, 'us-east-1');
    assert.equal(config.accessKeyId, 'test_access');
    assert.equal(config.secretAccessKey, 'test_secret');
    assert.equal(config.forcePathStyle, true);
    assert.equal(config.requestTimeoutMs, 5000); // Default timeout
    assert.equal(config.maxRetries, 3);          // Default retries
    assert.equal(config.buckets.media, 'munzi-media');
    assert.equal(config.buckets.kyc, 'munzi-kyc');
  });

  it('allows overriding request timeout and retry settings', () => {
    const config = resolveStorageConfig({
      requestTimeoutMs: 10000,
      maxRetries: 5,
    });

    assert.equal(config.requestTimeoutMs, 10000);
    assert.equal(config.maxRetries, 5);
  });

  it('redacts secret credentials and reflects timeout and retries in config summary', () => {
    const client = new S3StorageClient({
      endpoint: 'http://localhost:9000',
      accessKeyId: 'munzi_admin',
      secretAccessKey: 'super_secret_password_123',
      requestTimeoutMs: 7500,
      maxRetries: 4,
    });

    const summary = client.getConfigSummary();
    assert.equal(summary.endpoint, 'http://localhost:9000');
    assert.equal(summary.hasAccessKey, true);
    assert.equal(summary.forcePathStyle, true);
    assert.equal(summary.requestTimeoutMs, 7500);
    assert.equal(summary.maxRetries, 4);
    // Secret keys must never be exposed
    assert.equal((summary as any).secretAccessKey, undefined);
  });
});

// ─── Error Sanitization ────────────────────────────────────────────────────────

describe('S3 Storage Client — Error Sanitization', () => {
  it('redacts AWS secret keys and passwords from error messages', () => {
    const rawError = 'Connection failed with aws_secret_access_key=xyz123abc and password=mypassword';
    const sanitized = sanitizeErrorMessage(rawError);
    assert.equal(sanitized.includes('xyz123abc'), false);
    assert.equal(sanitized.includes('mypassword'), false);
    assert.equal(sanitized.includes('[REDACTED]'), true);
  });

  it('provides safe fallback message for empty error', () => {
    assert.equal(sanitizeErrorMessage(''), 'Storage operation failed');
  });
});

// ─── Strict KYC File Signature (Magic Bytes) Validation ────────────────────────

describe('S3 Storage Client — KYC File Signature Validation', () => {
  const validPdfBytes = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
  const validJpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const validPngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

  it('detects and approves valid PDF signatures', () => {
    assert.equal(detectFileSignature(validPdfBytes), 'pdf');
    const result = validateKycDocument(validPdfBytes, 'application/pdf');
    assert.equal(result.isValid, true);
    assert.equal(result.detectedFormat, 'pdf');
    assert.equal(result.mimeType, 'application/pdf');
  });

  it('detects and approves valid JPEG signatures', () => {
    assert.equal(detectFileSignature(validJpegBytes), 'jpeg');
    const result = validateKycDocument(validJpegBytes, 'image/jpeg');
    assert.equal(result.isValid, true);
    assert.equal(result.detectedFormat, 'jpeg');
    assert.equal(result.mimeType, 'image/jpeg');
  });

  it('detects and approves valid PNG signatures', () => {
    assert.equal(detectFileSignature(validPngBytes), 'png');
    const result = validateKycDocument(validPngBytes, 'image/png');
    assert.equal(result.isValid, true);
    assert.equal(result.detectedFormat, 'png');
    assert.equal(result.mimeType, 'image/png');
  });

  it('rejects spoofed MIME type when file signature does not match declaration', () => {
    assert.throws(
      () => validateKycDocument(validPngBytes, 'application/pdf'),
      StorageValidationError,
    );
  });

  it('rejects executable and script files even if disguised with image extension', () => {
    const bashScript = Buffer.from('#!/bin/bash\necho "exploit"');
    assert.equal(detectFileSignature(bashScript), null);
    assert.throws(
      () => validateKycDocument(bashScript, 'application/pdf'),
      StorageValidationError,
    );
  });

  it('rejects HTML and SVG files to prevent stored XSS attacks', () => {
    const svgFile = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    assert.equal(detectFileSignature(svgFile), null);
    assert.throws(
      () => validateKycDocument(svgFile, 'image/png'),
      StorageValidationError,
    );
  });

  it('rejects empty payloads and undersized buffers', () => {
    assert.throws(() => validateKycDocument(Buffer.alloc(0)), StorageValidationError);
    assert.throws(() => validateKycDocument(Buffer.from([0x01, 0x02])), StorageValidationError);
  });

  it('rejects oversized KYC files exceeding 15MB', () => {
    const oversized = Buffer.alloc(15 * 1024 * 1024 + 1);
    oversized[0] = 0x25;
    oversized[1] = 0x50;
    oversized[2] = 0x44;
    oversized[3] = 0x46; // %PDF
    assert.throws(() => validateKycDocument(oversized), StorageValidationError);
  });
});

// ─── Public Media Isolation & Defense in Depth ─────────────────────────────────

describe('S3 Storage Client — Public Media Isolation & Defense in Depth', () => {
  it('rejects uploads to public media when isPublicMedia is omitted or false', () => {
    assert.throws(
      () => validatePublicMediaUpload({
        key: 'products/sample.webp',
        contentType: 'image/webp',
      }),
      StorageValidationError,
    );

    assert.throws(
      () => validatePublicMediaUpload({
        key: 'products/sample.webp',
        contentType: 'image/webp',
        isPublicMedia: false,
      }),
      StorageValidationError,
    );
  });

  it('approves legitimate uploads with isPublicMedia: true, valid namespace, and valid MIME', () => {
    assert.doesNotThrow(() =>
      validatePublicMediaUpload({
        key: 'products/phone-front.webp',
        contentType: 'image/webp',
        isPublicMedia: true,
      }),
    );

    assert.doesNotThrow(() =>
      validatePublicMediaUpload({
        key: 'banners/summer-promo.png',
        contentType: 'image/png',
        isPublicMedia: true,
      }),
    );

    assert.doesNotThrow(() =>
      validatePublicMediaUpload({
        key: 'categories/apparel.jpg',
        contentType: 'image/jpeg',
        isPublicMedia: true,
      }),
    );

    assert.doesNotThrow(() =>
      validatePublicMediaUpload({
        key: 'avatars/usr-123.jpg',
        contentType: 'image/jpeg',
        isPublicMedia: true,
      }),
    );

    assert.doesNotThrow(() =>
      validatePublicMediaUpload({
        key: 'products/preview.mp4',
        contentType: 'video/mp4',
        isPublicMedia: true,
      }),
    );
  });

  it('rejects uploads outside approved namespaces even with isPublicMedia: true', () => {
    const disallowedKeys = [
      'documents/file.webp',
      'uploads/image.png',
      'misc/banner.jpg',
      'root-image.webp',
      'sellers/usr-1/photo.jpg',
    ];

    for (const key of disallowedKeys) {
      assert.throws(
        () => validatePublicMediaUpload({
          key,
          contentType: 'image/webp',
          isPublicMedia: true,
        }),
        StorageValidationError,
        `Expected rejection for key: ${key}`,
      );
    }
  });

  it('rejects documents and unapproved MIME types from public media bucket', () => {
    const disallowedMimes = [
      'application/pdf',
      'application/zip',
      'application/octet-stream',
      'text/html',
      'image/svg+xml',
      'application/x-sh',
      'text/plain',
    ];

    for (const mime of disallowedMimes) {
      assert.throws(
        () => validatePublicMediaUpload({
          key: 'products/item.jpg',
          contentType: mime,
          isPublicMedia: true,
        }),
        StorageValidationError,
        `Expected rejection for MIME: ${mime}`,
      );
    }
  });

  it('rejects sensitive documents with opaque/random filenames via payload signature inspection', () => {
    // Random UUID filename inside approved namespace, but body is actually a PDF document
    const fakeImagePdf = Buffer.from('%PDF-1.4 confidential seller identity scan');
    assert.throws(
      () => validatePublicMediaUpload({
        key: 'products/c9bf4a82-e1d3.webp',
        contentType: 'image/webp',
        isPublicMedia: true,
        bodyBuffer: fakeImagePdf,
      }),
      StorageValidationError,
    );

    // Random filename with SVG/HTML markup
    const fakeImageSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    assert.throws(
      () => validatePublicMediaUpload({
        key: 'banners/random-ad-789.png',
        contentType: 'image/png',
        isPublicMedia: true,
        bodyBuffer: fakeImageSvg,
      }),
      StorageValidationError,
    );

    // ZIP archive disguised as JPEG
    const fakeImageZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    assert.throws(
      () => validatePublicMediaUpload({
        key: 'categories/tech-archive.jpg',
        contentType: 'image/jpeg',
        isPublicMedia: true,
        bodyBuffer: fakeImageZip,
      }),
      StorageValidationError,
    );
  });

  it('rejects attempts to declare isPublicMedia: true on KYC bucket', async () => {
    const client = new S3StorageClient({
      endpoint: 'http://localhost:9000',
      buckets: { media: 'munzi-media', kyc: 'munzi-kyc' },
    });

    const validPdf = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj');

    await assert.rejects(
      async () => client.upload({
        bucket: 'kyc',
        key: 'sellers/doc.pdf',
        body: validPdf,
        contentType: 'application/pdf',
        isPublicMedia: true, // Caller tries to mark KYC file as public media
      }),
      StorageValidationError,
    );

    await assert.rejects(
      async () => client.getPresignedUploadUrl({
        bucket: 'kyc',
        key: 'sellers/doc.pdf',
        contentType: 'application/pdf',
        isPublicMedia: true,
      }),
      StorageValidationError,
    );
  });
});

// ─── Network Request Timeout & Handlers ────────────────────────────────────────

describe('S3 Storage Client — Request Timeouts & Handlers', () => {
  it('instantiates NodeHttpHandler with configured timeouts on SDK client', async () => {
    let capturedConfig: any = null;

    class MockNodeHttpHandler {
      options: any;
      constructor(options: any) {
        this.options = options;
      }
    }

    const mockSdk: AwsSdkBundle = {
      S3Client: class {
        constructor(config: any) {
          capturedConfig = config;
        }
      },
      PutObjectCommand: class {},
      GetObjectCommand: class {},
      DeleteObjectCommand: class {},
      HeadObjectCommand: class {},
      getSignedUrl: async () => 'https://mock.url',
      NodeHttpHandler: MockNodeHttpHandler,
    };

    const client = new S3StorageClient(
      { endpoint: 'http://localhost:9000', requestTimeoutMs: 3500 },
      undefined,
      mockSdk,
    );

    // Trigger SDK client initialization
    await (client as any).getSdkAndClient();

    assert.ok(capturedConfig);
    assert.ok(capturedConfig.requestHandler instanceof MockNodeHttpHandler);
    assert.equal(capturedConfig.requestHandler.options.requestTimeout, 3500);
    assert.equal(capturedConfig.requestHandler.options.connectionTimeout, 3500);
  });

  it('aborts stalled upload and throws StorageTimeoutError within configured timeout', async () => {
    const stalledClient: S3ClientProtocol = {
      async send(_cmd: any, options?: { abortSignal?: AbortSignal }) {
        return new Promise((_, reject) => {
          if (options?.abortSignal) {
            options.abortSignal.addEventListener('abort', () => {
              const err = new Error('Request aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      },
    };

    const client = new S3StorageClient(
      { requestTimeoutMs: 50 }, // 50ms timeout for test
      stalledClient,
      {
        S3Client: class {},
        PutObjectCommand: class { input: any; constructor(input: any) { this.input = input; } },
        GetObjectCommand: class {},
        DeleteObjectCommand: class {},
        HeadObjectCommand: class {},
        getSignedUrl: async () => '',
      } as any,
    );

    await assert.rejects(
      async () => client.upload({
        bucket: 'media',
        key: 'products/laptop.webp',
        body: Buffer.from('image-bytes'),
        contentType: 'image/webp',
        isPublicMedia: true,
      }),
      (err: any) => {
        assert.ok(err instanceof StorageTimeoutError);
        assert.equal(err.status, 504);
        assert.ok(err.message.includes('upload'));
        assert.ok(err.message.includes('50ms'));
        return true;
      },
    );
  });

  it('aborts stalled download, delete, and metadata operations', async () => {
    const stalledClient: S3ClientProtocol = {
      async send(_cmd: any, options?: { abortSignal?: AbortSignal }) {
        return new Promise((_, reject) => {
          if (options?.abortSignal) {
            options.abortSignal.addEventListener('abort', () => {
              const err = new Error('Request aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      },
    };

    const client = new S3StorageClient(
      { requestTimeoutMs: 30 },
      stalledClient,
      {
        S3Client: class {},
        PutObjectCommand: class {},
        GetObjectCommand: class { input: any; constructor(input: any) { this.input = input; } },
        DeleteObjectCommand: class { input: any; constructor(input: any) { this.input = input; } },
        HeadObjectCommand: class { input: any; constructor(input: any) { this.input = input; } },
        getSignedUrl: async () => '',
      } as any,
    );

    // 1. Download
    await assert.rejects(
      async () => client.download('media', 'products/laptop.webp'),
      (err: any) => err instanceof StorageTimeoutError && err.status === 504,
    );

    // 2. Delete
    await assert.rejects(
      async () => client.delete({ bucket: 'media', key: 'products/laptop.webp' }),
      (err: any) => err instanceof StorageTimeoutError && err.status === 504,
    );

    // 3. Metadata
    await assert.rejects(
      async () => client.getMetadata('media', 'products/laptop.webp'),
      (err: any) => err instanceof StorageTimeoutError && err.status === 504,
    );
  });

  it('ensures retries do not continue after abort cancellation', async () => {
    let callCount = 0;
    const stalledClientWithRetries: S3ClientProtocol = {
      async send(_cmd: any, options?: { abortSignal?: AbortSignal }) {
        callCount++;
        return new Promise((_, reject) => {
          if (options?.abortSignal) {
            options.abortSignal.addEventListener('abort', () => {
              const err = new Error('Operation aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      },
    };

    const client = new S3StorageClient(
      { requestTimeoutMs: 40, maxRetries: 3 },
      stalledClientWithRetries,
      {
        S3Client: class {},
        PutObjectCommand: class { input: any; constructor(input: any) { this.input = input; } },
        GetObjectCommand: class {},
        DeleteObjectCommand: class {},
        HeadObjectCommand: class {},
        getSignedUrl: async () => '',
      } as any,
    );

    await assert.rejects(
      async () => client.upload({
        bucket: 'media',
        key: 'products/test.webp',
        body: Buffer.from('img'),
        contentType: 'image/webp',
        isPublicMedia: true,
      }),
      StorageTimeoutError,
    );

    // Once aborted by the timeout signal, no secondary retry loop must hang
    assert.equal(callCount, 1);
  });
});

// ─── S3 Storage Client — Mock Operations & Privacy Guarantees ──────────────────

describe('S3 Storage Client — Mock Operations & Privacy Guarantees', () => {
  const sentCommands: any[] = [];
  const mockClient: S3ClientProtocol = {
    async send(cmd: any) {
      sentCommands.push(cmd);
      if (cmd.type === 'GetObject') {
        if (cmd.input.Key === 'products/not-found.jpg') {
          const err = new Error('NoSuchKey');
          (err as any).name = 'NoSuchKey';
          (err as any).$metadata = { httpStatusCode: 404 };
          throw err;
        }
        return {
          Body: Buffer.from('hello-munzi-file-content'),
          ContentType: 'text/plain',
          ContentLength: 24,
        };
      }
      return { $metadata: { httpStatusCode: 200 } };
    },
  };

  const mockSdk: AwsSdkBundle = {
    S3Client: class {},
    PutObjectCommand: class {
      type = 'PutObject';
      input: any;
      constructor(input: any) {
        this.input = input;
      }
    },
    GetObjectCommand: class {
      type = 'GetObject';
      input: any;
      constructor(input: any) {
        this.input = input;
      }
    },
    DeleteObjectCommand: class {
      type = 'DeleteObject';
      input: any;
      constructor(input: any) {
        this.input = input;
      }
    },
    HeadObjectCommand: class {
      type = 'HeadObject';
      input: any;
      constructor(input: any) {
        this.input = input;
      }
    },
    getSignedUrl: async (_c: any, cmd: any, opts: any) => {
      return `https://mock-s3.local/${cmd.input.Bucket}/${cmd.input.Key}?expires=${opts.expiresIn}&signed=true`;
    },
  };

  it('uploads an approved public media file and generates path-style URL', async () => {
    const client = new S3StorageClient(
      { endpoint: 'http://localhost:9000', buckets: { media: 'munzi-media', kyc: 'munzi-kyc' } },
      mockClient,
      mockSdk,
    );

    const result = await client.upload({
      bucket: 'media',
      key: 'products/sample.webp',
      body: Buffer.from('test-image-data'),
      contentType: 'image/webp',
      isPublicMedia: true,
    });

    assert.equal(result.bucket, 'munzi-media');
    assert.equal(result.key, 'products/sample.webp');
    assert.equal(result.s3Uri, 's3://munzi-media/products/sample.webp');
    assert.equal(result.url, 'http://localhost:9000/munzi-media/products/sample.webp');
    assert.equal(result.sizeBytes, 15);
  });

  it('uploads a verified KYC PDF with private ACL and returns safe s3Uri without public URL', async () => {
    const client = new S3StorageClient(
      { endpoint: 'http://localhost:9000', buckets: { media: 'munzi-media', kyc: 'munzi-kyc' } },
      mockClient,
      mockSdk,
    );

    const validPdf = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj');

    const result = await client.upload({
      bucket: 'kyc',
      key: 'sellers/usr-1/passport.pdf',
      body: validPdf,
      contentType: 'application/pdf',
      isPrivate: true,
    });

    assert.equal(result.bucket, 'munzi-kyc');
    assert.equal(result.key, 'sellers/usr-1/passport.pdf');
    assert.equal(result.s3Uri, 's3://munzi-kyc/sellers/usr-1/passport.pdf');
    // Private KYC file URL MUST equal s3Uri, NEVER a direct public HTTP/CDN URL
    assert.equal(result.url, 's3://munzi-kyc/sellers/usr-1/passport.pdf');

    // Verify command was sent with ACL: private
    const lastCmd = sentCommands[sentCommands.length - 1];
    assert.equal(lastCmd.input.ACL, 'private');
  });

  it('forces private ACL on KYC bucket even if caller passes isPrivate: false', async () => {
    const client = new S3StorageClient(
      { endpoint: 'http://localhost:9000', buckets: { media: 'munzi-media', kyc: 'munzi-kyc' } },
      mockClient,
      mockSdk,
    );

    const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

    const result = await client.upload({
      bucket: 'kyc',
      key: 'sellers/usr-2/license.png',
      body: validPng,
      contentType: 'image/png',
      isPrivate: false, // Attempt to mark KYC file as public
    });

    assert.equal(result.url, 's3://munzi-kyc/sellers/usr-2/license.png'); // Overridden to private
    const lastCmd = sentCommands[sentCommands.length - 1];
    assert.equal(lastCmd.input.ACL, 'private');
  });

  it('downloads an existing object into a buffer', async () => {
    const client = new S3StorageClient(
      { endpoint: 'http://localhost:9000' },
      mockClient,
      mockSdk,
    );

    const result = await client.download('media', 'products/sample.txt');
    assert.equal(result.key, 'products/sample.txt');
    assert.equal(result.body.toString('utf-8'), 'hello-munzi-file-content');
    assert.equal(result.contentType, 'text/plain');
  });

  it('throws StorageNotFoundError when downloading a non-existent key', async () => {
    const client = new S3StorageClient(
      { endpoint: 'http://localhost:9000' },
      mockClient,
      mockSdk,
    );

    await assert.rejects(
      async () => client.download('media', 'products/not-found.jpg'),
      StorageNotFoundError,
    );
  });

  it('generates presigned download URLs with configurable expiry', async () => {
    const client = new S3StorageClient(
      { endpoint: 'http://localhost:9000' },
      mockClient,
      mockSdk,
    );

    const signedUrl = await client.getPresignedDownloadUrl({
      bucket: 'kyc',
      key: 'sellers/usr-1/doc.pdf',
      expiresInSeconds: 300,
    });

    assert.equal(signedUrl.includes('munzi-kyc/sellers/usr-1/doc.pdf'), true);
    assert.equal(signedUrl.includes('expires=300'), true);
    assert.equal(signedUrl.includes('signed=true'), true);
  });

  it('generates presigned upload URLs for allowed KYC MIME types and rejects disallowed types', async () => {
    const client = new S3StorageClient(
      { endpoint: 'http://localhost:9000', buckets: { media: 'munzi-media', kyc: 'munzi-kyc' } },
      mockClient,
      mockSdk,
    );

    // Allowed: application/pdf
    const validUrl = await client.getPresignedUploadUrl({
      bucket: 'kyc',
      key: 'sellers/usr-1/doc.pdf',
      contentType: 'application/pdf',
      expiresInSeconds: 600,
    });
    assert.equal(validUrl.includes('munzi-kyc/sellers/usr-1/doc.pdf'), true);

    // Disallowed: text/html
    await assert.rejects(
      async () => client.getPresignedUploadUrl({
        bucket: 'kyc',
        key: 'sellers/usr-1/doc.html',
        contentType: 'text/html',
      }),
      StorageValidationError,
    );

    // Missing Content-Type for KYC
    await assert.rejects(
      async () => client.getPresignedUploadUrl({
        bucket: 'kyc',
        key: 'sellers/usr-1/doc.pdf',
      }),
      StorageValidationError,
    );
  });

  it('generates presigned upload URLs for public media with isPublicMedia: true', async () => {
    const client = new S3StorageClient(
      { endpoint: 'http://localhost:9000', buckets: { media: 'munzi-media', kyc: 'munzi-kyc' } },
      mockClient,
      mockSdk,
    );

    const validUrl = await client.getPresignedUploadUrl({
      bucket: 'media',
      key: 'products/upload-target.webp',
      contentType: 'image/webp',
      isPublicMedia: true,
      expiresInSeconds: 600,
    });

    assert.equal(validUrl.includes('munzi-media/products/upload-target.webp'), true);
    assert.equal(validUrl.includes('expires=600'), true);

    // Fails if isPublicMedia is omitted
    await assert.rejects(
      async () => client.getPresignedUploadUrl({
        bucket: 'media',
        key: 'products/upload-target.webp',
        contentType: 'image/webp',
      }),
      StorageValidationError,
    );
  });
});
