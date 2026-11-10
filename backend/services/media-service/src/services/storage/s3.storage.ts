import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { StorageProvider } from './local.storage.js';

export class S3StorageProvider implements StorageProvider {
  private s3: S3Client;
  private bucket: string;
  private cdnBaseUrl: string;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT || process.env.AWS_ENDPOINT;
    const region = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';
    const accessKeyId = process.env.S3_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID || '';
    const secretAccessKey = process.env.S3_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY || '';
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true' || Boolean(endpoint);

    const clientConfig: Record<string, unknown> = {
      region,
      forcePathStyle,
    };

    if (endpoint) {
      clientConfig.endpoint = endpoint;
    }

    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = { accessKeyId, secretAccessKey };
    }

    this.s3 = new S3Client(clientConfig as any);
    this.bucket = process.env.S3_BUCKET_MEDIA || process.env.AWS_S3_BUCKET || 'munzi-media';

    if (process.env.CDN_BASE_URL) {
      this.cdnBaseUrl = process.env.CDN_BASE_URL;
    } else if (endpoint) {
      this.cdnBaseUrl = `${endpoint.replace(/\/+$/, '')}/${this.bucket}`;
    } else {
      this.cdnBaseUrl = `https://${this.bucket}.s3.amazonaws.com`;
    }
  }

  async upload(fileBuffer: Buffer, filename: string, mimeType: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: filename,
      Body: fileBuffer,
      ContentType: mimeType,
    });
    await this.s3.send(command);
    return this.getUrl(filename);
  }

  async delete(filename: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: filename,
    });
    await this.s3.send(command);
  }

  getUrl(filename: string): string {
    return `${this.cdnBaseUrl}/${filename}`;
  }
}
