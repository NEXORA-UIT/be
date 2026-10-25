import { FileSystemObjectStorage, type ObjectStorage } from './object-storage.js';
import { R2ObjectStorage } from './r2-object-storage.js';

export function createAttachmentStorage(
  environment: NodeJS.ProcessEnv = process.env,
): ObjectStorage {
  const provider = environment.ATTACHMENT_STORAGE_PROVIDER?.trim().toLowerCase();

  if (environment.NODE_ENV === 'production' && provider !== 'r2') {
    throw new Error('Production requires ATTACHMENT_STORAGE_PROVIDER=r2');
  }

  if (!provider || provider === 'filesystem') {
    return new FileSystemObjectStorage(environment.ATTACHMENT_STORAGE_DIR);
  }

  if (provider !== 'r2') {
    throw new Error('ATTACHMENT_STORAGE_PROVIDER must be filesystem or r2');
  }

  return new R2ObjectStorage({
    endpoint: environment.R2_ENDPOINT?.trim() ?? '',
    bucket: environment.R2_BUCKET?.trim() ?? '',
    accessKeyId: environment.R2_ACCESS_KEY_ID?.trim() ?? '',
    secretAccessKey: environment.R2_SECRET_ACCESS_KEY?.trim() ?? '',
  });
}

export const attachmentStorage: ObjectStorage = createAttachmentStorage();
