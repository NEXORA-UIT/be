import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeAttachmentFilename } from '../../src/modules/collaboration/utils/attachment-filename.util.js';
import { resolveAttachmentMime } from '../../src/modules/collaboration/utils/attachment-mime.util.js';

describe('attachment filename header decoding', () => {
  it('decodes the UTF-8 base64 header', () => {
    assert.equal(
      decodeAttachmentFilename(
        Buffer.from('Báo cáo quý 1.pdf', 'utf8').toString('base64'),
        undefined,
      ),
      'Báo cáo quý 1.pdf',
    );
  });

  it('supports percent-encoded legacy filenames and plain ASCII names', () => {
    assert.equal(decodeAttachmentFilename(undefined, 'B%C3%A1o%20c%C3%A1o.pdf'), 'Báo cáo.pdf');
    assert.equal(decodeAttachmentFilename(undefined, 'design.pdf'), 'design.pdf');
  });

  it('rejects malformed base64, invalid UTF-8, and malformed percent encoding', () => {
    assert.throws(() => decodeAttachmentFilename('%%%bad', undefined), {
      code: 'ATTACHMENT_METADATA_INVALID',
    });
    assert.throws(() => decodeAttachmentFilename('/w==', undefined), {
      code: 'ATTACHMENT_METADATA_INVALID',
    });
    assert.throws(() => decodeAttachmentFilename(undefined, 'bad%ZZname.pdf'), {
      code: 'ATTACHMENT_METADATA_INVALID',
    });
  });
});

describe('attachment MIME detection', () => {
  it('sniffs supported formats when the client sends application/octet-stream', () => {
    const docxContent = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('word/document.xml'),
    ]);
    assert.equal(
      resolveAttachmentMime('application/octet-stream', docxContent),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('rejects unknown content and mismatched explicit MIME types', () => {
    assert.equal(resolveAttachmentMime('application/octet-stream', Buffer.from([0, 1, 2])), null);
    assert.equal(resolveAttachmentMime('image/png', Buffer.from('%PDF-1.7')), null);
  });
});
