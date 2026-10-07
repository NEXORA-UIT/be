import type { Request, Response } from 'express';
import {
  createWorkspace,
  getWorkspace,
  listWorkspaceMembers,
  listWorkspaces,
  updateWorkspace,
  archiveWorkspace,
  restoreWorkspace,
  transferWorkspaceOwner,
  removeWorkspaceMember,
  leaveWorkspace,
} from '../services/workspace.service.js';

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string') throw new Error(`Missing route parameter: ${name}`);
  return value;
}

export async function createWorkspaceController(req: Request, res: Response) {
  res.status(201).json({ success: true, data: await createWorkspace(req.auth.userId, req.body) });
}
export async function listWorkspacesController(req: Request, res: Response) {
  res.json({ success: true, data: await listWorkspaces(req.auth.userId) });
}
export async function getWorkspaceController(req: Request, res: Response) {
  res.json({ success: true, data: await getWorkspace(req.auth.userId, param(req, 'id')) });
}
export async function updateWorkspaceController(req: Request, res: Response) {
  res.json({
    success: true,
    data: await updateWorkspace(req.auth.userId, param(req, 'id'), req.body),
  });
}
export async function archiveWorkspaceController(req: Request, res: Response) {
  res.json({ success: true, data: await archiveWorkspace(req.auth.userId, param(req, 'id')) });
}
export async function restoreWorkspaceController(req: Request, res: Response) {
  res.json({ success: true, data: await restoreWorkspace(req.auth.userId, param(req, 'id')) });
}
export async function listWorkspaceMembersController(req: Request, res: Response) {
  res.json({
    success: true,
    data: await listWorkspaceMembers(req.auth.userId, param(req, 'id')),
  });
}
export async function transferWorkspaceOwnerController(req: Request, res: Response) {
  res.json({
    success: true,
    data: await transferWorkspaceOwner(req.auth.userId, param(req, 'id'), param(req, 'userId')),
  });
}
export async function removeWorkspaceMemberController(req: Request, res: Response) {
  res.json({
    success: true,
    data: await removeWorkspaceMember(req.auth.userId, param(req, 'id'), param(req, 'userId')),
  });
}
export async function leaveWorkspaceController(req: Request, res: Response) {
  res.json({ success: true, data: await leaveWorkspace(req.auth.userId, param(req, 'id')) });
}
