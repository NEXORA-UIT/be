import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';

const ATTACHMENT_STORAGE_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKSPACE_ATTACHMENT_STORAGE_KEY_PATTERN =
  /^workspaces\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/boards\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(?!\.{1,2}$)(?:[A-Za-z0-9._~-]|%[0-9A-F]{2})+$/i;

export interface ObjectStoragePutOptions {
  storageKey: string;
  contentType: string;
  fileName: string;
}

export function assertValidAttachmentStorageKey(storageKey: string): void {
  if (
    !ATTACHMENT_STORAGE_KEY_PATTERN.test(storageKey) &&
    !WORKSPACE_ATTACHMENT_STORAGE_KEY_PATTERN.test(storageKey)
  ) {
    throw new Error('Invalid attachment storage key');
  }
}

export interface ObjectStorage {
  put(content: Uint8Array, options: ObjectStoragePutOptions): Promise<string>;
  get(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
}

export class FileSystemObjectStorage implements ObjectStorage {
  private readonly root: string;

  constructor(directory = process.env.ATTACHMENT_STORAGE_DIR) {
    const configured = directory?.trim();
    this.root = resolve(configured || join(process.cwd(), '.data', 'attachments'));
    if (!isAbsolute(this.root))
      throw new Error('ATTACHMENT_STORAGE_DIR must resolve to an absolute path');
  }

  private pathFor(storageKey: string): string {
    assertValidAttachmentStorageKey(storageKey);
    const path = resolve(this.root, storageKey);
    if (!path.startsWith(`${this.root}${sep}`)) throw new Error('Invalid attachment storage key');
    return path;
  }

  async put(content: Uint8Array, { storageKey }: ObjectStoragePutOptions): Promise<string> {
    assertValidAttachmentStorageKey(storageKey);
    const target = this.pathFor(storageKey);
    await mkdir(resolve(target, '..'), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(content);
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    return storageKey;
  }

  async get(storageKey: string): Promise<Buffer> {
    const file = await open(this.pathFor(storageKey), 'r');
    try {
      return await file.readFile();
    } finally {
      await file.close();
    }
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.pathFor(storageKey), { force: true });
  }
}
