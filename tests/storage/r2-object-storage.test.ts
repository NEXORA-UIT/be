import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createAttachmentStorage } from '../../src/infrastructure/storage/attachment-storage.js';
import { R2ObjectStorage } from '../../src/infrastructure/storage/r2-object-storage.js';

const config = {
  endpoint: 'https://account.r2.cloudflarestorage.com',
  bucket: 'nexora-attachments',
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-key',
};

function createFakeS3Client(
  send: (command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand) => Promise<unknown>,
) {
  return { send } as unknown as S3Client;
}

describe('R2 object storage', () => {
  it('puts and reads bytes from the configured bucket', async () => {
    const commands: (PutObjectCommand | GetObjectCommand | DeleteObjectCommand)[] = [];
    const bytes = Buffer.from('R2 attachment');
    const client = createFakeS3Client(async (command) => {
      commands.push(command);
      if (command instanceof GetObjectCommand) {
        return { Body: { transformToByteArray: async () => bytes } };
      }
      return {};
    });
    const storage = new R2ObjectStorage(config, client);

    const key = await storage.put(bytes);
    assert.match(key, /^[0-9a-f-]{36}$/i);
    assert.ok(commands[0] instanceof PutObjectCommand);
    assert.equal(commands[0]?.input.Bucket, config.bucket);
    assert.equal(commands[0]?.input.Key, key);
    assert.deepEqual(commands[0]?.input.Body, bytes);
    assert.deepEqual(await storage.get(key), bytes);
    assert.ok(commands[1] instanceof GetObjectCommand);
    assert.equal(commands[1]?.input.Bucket, config.bucket);
    assert.equal(commands[1]?.input.Key, key);
  });

  it('deletes objects idempotently by allowing repeated delete requests', async () => {
    const commands: DeleteObjectCommand[] = [];
    const storage = new R2ObjectStorage(
      config,
      createFakeS3Client(async (command) => {
        assert.ok(command instanceof DeleteObjectCommand);
        commands.push(command);
        return {};
      }),
    );
    const key = '2a41f05e-8dc6-4cac-b9f2-019d52f2edda';

    await storage.delete(key);
    await storage.delete(key);

    assert.equal(commands.length, 2);
    assert.equal(commands[0]?.input.Bucket, config.bucket);
    assert.equal(commands[0]?.input.Key, key);
  });

  it('rejects missing configuration and malformed object keys', async () => {
    assert.throws(() => new R2ObjectStorage({ ...config, bucket: '' }), /R2_BUCKET/);
    const storage = new R2ObjectStorage(
      config,
      createFakeS3Client(async () => ({})),
    );
    await assert.rejects(() => storage.get('../private'), /Invalid attachment storage key/);
    await assert.rejects(() => storage.delete('not-a-uuid'), /Invalid attachment storage key/);
  });

  it('surfaces upload and delete failures so callers can retain cleanup state', async () => {
    const storage = new R2ObjectStorage(
      config,
      createFakeS3Client(async () => {
        throw new Error('simulated R2 outage');
      }),
    );

    await assert.rejects(() => storage.put(Buffer.from('fail')), /simulated R2 outage/);
    await assert.rejects(
      () => storage.delete('2a41f05e-8dc6-4cac-b9f2-019d52f2edda'),
      /simulated R2 outage/,
    );
  });

  it('requires R2 in production and rejects incomplete credentials at startup', () => {
    assert.throws(
      () =>
        createAttachmentStorage({
          NODE_ENV: 'production',
          ATTACHMENT_STORAGE_PROVIDER: 'filesystem',
        }),
      /requires ATTACHMENT_STORAGE_PROVIDER=r2/,
    );
    assert.throws(
      () =>
        createAttachmentStorage({
          NODE_ENV: 'production',
          ATTACHMENT_STORAGE_PROVIDER: 'r2',
          R2_ENDPOINT: config.endpoint,
        }),
      /R2_BUCKET.*R2_ACCESS_KEY_ID.*R2_SECRET_ACCESS_KEY/,
    );

    assert.ok(
      createAttachmentStorage({
        NODE_ENV: 'production',
        ATTACHMENT_STORAGE_PROVIDER: 'r2',
        R2_ENDPOINT: config.endpoint,
        R2_BUCKET: config.bucket,
        R2_ACCESS_KEY_ID: config.accessKeyId,
        R2_SECRET_ACCESS_KEY: config.secretAccessKey,
      }) instanceof R2ObjectStorage,
    );
  });
});
