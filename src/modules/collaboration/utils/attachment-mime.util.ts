export const ATTACHMENT_MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/plain': '.txt',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

export function sniffAttachmentMime(content: Uint8Array): string | null {
  const bytes = Buffer.from(content);
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04 &&
    bytes.includes(Buffer.from('word/document.xml'))
  ) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (!bytes.includes(0)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return 'text/plain';
    } catch {
      /* not UTF-8 text */
    }
  }
  return null;
}

export function resolveAttachmentMime(declaredMime: string, content: Uint8Array) {
  const detectedMime = sniffAttachmentMime(content);
  if (!detectedMime || !ATTACHMENT_MIME_EXTENSIONS[detectedMime]) return null;
  if (declaredMime !== 'application/octet-stream' && declaredMime !== detectedMime) return null;
  return detectedMime;
}
