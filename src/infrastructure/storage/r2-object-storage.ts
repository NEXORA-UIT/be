import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  assertValidAttachmentStorageKey,
  type ObjectStorage,
  type ObjectStoragePutOptions,
} from './object-storage.js';

export interface R2StorageConfiguration {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

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

  async put(content: Uint8Array, options: ObjectStoragePutOptions): Promise<string> {
    const { storageKey, contentType, fileName } = options;
    assertValidAttachmentStorageKey(storageKey);
    const encodedFileName = encodeURIComponent(fileName).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.configuration.bucket,
        Key: storageKey,
        Body: content,
        ContentType: contentType,
        ContentDisposition: `attachment; filename*=UTF-8''${encodedFileName}`,
      }),
    );
    return storageKey;
  }

  async get(storageKey: string): Promise<Buffer> {
    assertValidAttachmentStorageKey(storageKey);
    const response = (await this.client.send(
      new GetObjectCommand({ Bucket: this.configuration.bucket, Key: storageKey }),
    )) as { Body?: { transformToByteArray(): Promise<Uint8Array> } | null };
    if (!response.Body) throw new Error('R2 object response did not include a body');
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async delete(storageKey: string): Promise<void> {
    assertValidAttachmentStorageKey(storageKey);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.configuration.bucket, Key: storageKey }),
    );
  }
}
