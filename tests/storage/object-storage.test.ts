import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { FileSystemObjectStorage } from '../../src/infrastructure/storage/object-storage.js';

describe('filesystem object storage', () => {
  it('writes, reads, and deletes attachments under hierarchical workspace keys', async () => {
    const root = await mkdtemp(join(process.cwd(), '.test-attachments-'));
    try {
      const storage = new FileSystemObjectStorage(root);
      const storageKey =
        'workspaces/2a41f05e-8dc6-4cac-b9f2-019d52f2edda/boards/2a41f05e-8dc6-4cac-b9f2-019d52f2edda/2a41f05e-8dc6-4cac-b9f2-019d52f2edda/report.pdf';
      const bytes = Buffer.from('attachment contents');

      assert.equal(
        await storage.put(bytes, {
          storageKey,
          contentType: 'application/pdf',
          fileName: 'report.pdf',
        }),
        storageKey,
      );
      assert.deepEqual(await storage.get(storageKey), bytes);
      assert.deepEqual(await readFile(join(root, storageKey)), bytes);

      await storage.delete(storageKey);
      await assert.rejects(() => storage.get(storageKey));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
