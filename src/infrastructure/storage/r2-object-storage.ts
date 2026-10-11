import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { ObjectStorage } from './object-storage.js';

export interface R2StorageConfiguration {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StorageCommand = PutObjectCommand | GetObjectCommand | DeleteObjectCommand;

interface S3CommandClient {
  send(command: StorageCommand): Promise<unknown>;
}

function validateConfiguration(configuration: R2StorageConfiguration): void {
  const missing: string[] = [];
  if (!configuration.endpoint) missing.push('R2_ENDPOINT');
  if (!configuration.bucket) missing.push('R2_BUCKET');
  if (!configuration.accessKeyId) missing.push('R2_ACCESS_KEY_ID');
  if (!configuration.secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
  if (missing.length > 0) {
    throw new Error(`R2 configuration is missing: ${missing.join(', ')}`);
  }

  let endpoint: URL;
  try {
    endpoint = new URL(configuration.endpoint);
  } catch {
    throw new Error('R2_ENDPOINT must be a valid URL');
  }
  if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') {
    throw new Error('R2_ENDPOINT must use HTTP or HTTPS');
  }
}

export class R2ObjectStorage implements ObjectStorage {
  private readonly client: S3CommandClient;

  constructor(
    private readonly configuration: R2StorageConfiguration,
    client?: S3Client,
  ) {
    validateConfiguration(configuration);
    this.client = (client ??
      new S3Client({
        region: 'auto',
        endpoint: configuration.endpoint,
        credentials: {
          accessKeyId: configuration.accessKeyId,
          secretAccessKey: configuration.secretAccessKey,
        },
      })) as unknown as S3CommandClient;
  }

  async put(content: Uint8Array): Promise<string> {
    const storageKey = randomUUID();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.configuration.bucket,
        Key: storageKey,
        Body: content,
      }),
    );
    return storageKey;
  }

  async get(storageKey: string): Promise<Buffer> {
    this.validateStorageKey(storageKey);
    const response = (await this.client.send(
      new GetObjectCommand({ Bucket: this.configuration.bucket, Key: storageKey }),
    )) as { Body?: { transformToByteArray(): Promise<Uint8Array> } | null };
    if (!response.Body) throw new Error('R2 object response did not include a body');
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async delete(storageKey: string): Promise<void> {
    this.validateStorageKey(storageKey);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.configuration.bucket, Key: storageKey }),
    );
  }

  private validateStorageKey(storageKey: string): void {
    if (!UUID_PATTERN.test(storageKey)) throw new Error('Invalid attachment storage key');
  }
}
