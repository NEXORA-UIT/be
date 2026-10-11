import type { Request, Response } from 'express';
import {
  authorizeCardAttachmentUpload,
  MAX_ATTACHMENT_BYTES,
  createComment,
  deleteCardAttachment,
  deleteComment,
  listCardActivity,
  listCardAttachments,
  listComments,
  readCardAttachment,
  updateComment,
  uploadCardAttachment,
} from '../services/collaboration.service.js';
import { parseActivityQuery, parseUuid } from '../dto/collaboration.schema.js';
import { AppError } from '../../../shared/errors/app.error.js';

function param(request: Request, name: string) {
  const value = request.params[name];
  if (typeof value !== 'string') throw new AppError(400, 'VALIDATION_ERROR', 'Thiếu ID tài nguyên');
  return parseUuid(value);
}

async function readRawFile(request: Request): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_ATTACHMENT_BYTES)
      throw new AppError(413, 'PAYLOAD_TOO_LARGE', 'Dung lượng tệp đính kèm tối đa là 25MB');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}

export async function listCommentsController(request: Request, response: Response) {
  response.json({
    success: true,
    ...(await listComments(request.auth.userId, param(request, 'cardId'))),
  });
}

export async function createCommentController(request: Request, response: Response) {
  const comment = await createComment(
    request.auth.userId,
    param(request, 'cardId'),
    request.body.content,
  );
  response.status(201).json({ success: true, data: comment });
}

export async function updateCommentController(request: Request, response: Response) {
  const comment = await updateComment(
    request.auth.userId,
    param(request, 'commentId'),
    request.body.content,
  );
  response.json({ success: true, data: comment });
}

export async function deleteCommentController(request: Request, response: Response) {
  await deleteComment(request.auth.userId, param(request, 'commentId'));
  response.json({ success: true, data: {} });
}

export async function listCardActivityController(request: Request, response: Response) {
  const query = parseActivityQuery(request.query);
  response.json({
    success: true,
    ...(await listCardActivity(
      request.auth.userId,
      param(request, 'cardId'),
      query.limit,
      query.cursor,
    )),
  });
}

export async function listCardAttachmentsController(request: Request, response: Response) {
  response.json({
    success: true,
    ...(await listCardAttachments(request.auth.userId, param(request, 'cardId'))),
  });
}

export async function uploadCardAttachmentController(request: Request, response: Response) {
  const cardId = param(request, 'cardId');
  await authorizeCardAttachmentUpload(request.auth.userId, cardId);
  const fileName = request.header('x-file-name');
  const mimeType = request.header('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (!fileName || !mimeType)
    throw new AppError(400, 'ATTACHMENT_METADATA_REQUIRED', 'Yêu cầu tên tệp và Content-Type');
  const content = await readRawFile(request);
  const attachment = await uploadCardAttachment(
    request.auth.userId,
    cardId,
    fileName,
    mimeType,
    content,
  );
  response.status(201).json({ success: true, data: attachment });
}

export async function downloadCardAttachmentController(request: Request, response: Response) {
  const { attachment, content } = await readCardAttachment(
    request.auth.userId,
    param(request, 'attachmentId'),
  );
  response.setHeader('Content-Type', attachment.mimeType ?? 'application/octet-stream');
  response.setHeader('Content-Length', String(content.byteLength));
  response.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
  );
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.send(content);
}

export async function deleteCardAttachmentController(request: Request, response: Response) {
  await deleteCardAttachment(request.auth.userId, param(request, 'attachmentId'));
  response.json({ success: true, data: {} });
}
