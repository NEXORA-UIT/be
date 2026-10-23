import { AppError } from '../../../shared/errors/app.error.js';

function invalidFilenameHeader() {
  return new AppError(400, 'ATTACHMENT_METADATA_INVALID', 'Tên tệp đính kèm không hợp lệ');
}

function decodeBase64Utf8(value: string) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) {
    throw invalidFilenameHeader();
  }

  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) {
    throw invalidFilenameHeader();
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw invalidFilenameHeader();
  }
}

export function decodeAttachmentFilename(base64Name?: string, legacyName?: string) {
  if (base64Name !== undefined) {
    const decoded = decodeBase64Utf8(base64Name);
    if (!decoded.trim()) throw invalidFilenameHeader();
    return decoded;
  }

  if (!legacyName) {
    throw new AppError(400, 'ATTACHMENT_METADATA_REQUIRED', 'Yêu cầu tên tệp và Content-Type');
  }

  try {
    const decoded = legacyName.includes('%') ? decodeURIComponent(legacyName) : legacyName;
    if (!decoded.trim()) throw invalidFilenameHeader();
    return decoded;
  } catch {
    throw invalidFilenameHeader();
  }
}
