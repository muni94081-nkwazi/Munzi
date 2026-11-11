// ─── MinIO Integration Tests — MUNZI Platform ─────────────────────────────────
//
// Integration test against a running MinIO instance (local Docker or remote).
// Probes connection on startup: executes live integration suite if MinIO is reachable,
// or gracefully skips with diagnostic instructions if MinIO is not running.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { S3StorageClient, resolveStorageConfig } from '../s3.client.ts';

const config = resolveStorageConfig();
const endpoint = config.endpoint || 'http://localhost:9000';

async function isMinioReachable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(`${endpoint.replace(/\/+$/, '')}/minio/health/live`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.status === 200;
  } catch {
    return false;
  }
}

describe('MinIO Live Integration Tests (Docker Dependent)', async () => {
  const reachable = await isMinioReachable();

  if (!reachable) {
    it(`SKIPPED: MinIO is not reachable at ${endpoint}. Start Docker & MinIO to run integration suite.`, (t) => {
      t.skip(`MinIO offline at ${endpoint}`);
    });
    return;
  }

  const client = new S3StorageClient({
    endpoint,
    accessKeyId: config.accessKeyId || 'munzi_admin',
    secretAccessKey: config.secretAccessKey || 'munzi_secret_key_change_me',
    forcePathStyle: true,
  });

  const testKey = `integration-tests/test-${Date.now()}.txt`;
  const testPayload = `MUNZI S3 Verification Payload - ${new Date().toISOString()}`;

  it('uploads a test file to munzi-media', async () => {
    const result = await client.upload({
      bucket: 'media',
      key: testKey,
      body: Buffer.from(testPayload, 'utf-8'),
      contentType: 'text/plain',
    });

    assert.equal(result.bucket, 'munzi-media');
    assert.equal(result.key, testKey);
    assert.equal(result.url, `${endpoint}/munzi-media/${testKey}`);
  });

  it('downloads the test file and validates exact bit-for-bit payload', async () => {
    const downloaded = await client.download('media', testKey);
    assert.equal(downloaded.body.toString('utf-8'), testPayload);
    assert.equal(downloaded.contentType, 'text/plain');
  });

  it('generates a presigned download URL', async () => {
    const presigned = await client.getPresignedDownloadUrl({
      bucket: 'media',
      key: testKey,
      expiresInSeconds: 60,
    });
    assert.equal(presigned.includes(testKey), true);
  });

  it('deletes the test file and cleans up', async () => {
    await client.delete({ bucket: 'media', key: testKey });
  });
});
