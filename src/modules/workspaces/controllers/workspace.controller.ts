import type { Request, Response } from 'express';
import { parseWorkspacePaginationQuery } from '../dto/workspace.schema.js';
import {
  archiveWorkspace,
  createWorkspace,
  getWorkspace,
  listWorkspaceMembers,
  listWorkspaces,
  leaveWorkspace,
  removeWorkspaceMember,
  restoreWorkspace,
  transferWorkspaceOwner,
  updateWorkspace,
} from '../services/workspace.service.js';

function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string') throw new Error(`Missing route parameter: ${name}`);
  return value;
}

export async function createWorkspaceController(req: Request, res: Response) {
  const workspace = await createWorkspace(req.auth.userId, req.body);
  res.status(201).json({ success: true, data: workspace });
}

export async function listWorkspacesController(req: Request, res: Response) {
  const query = parseWorkspacePaginationQuery(req.query);
  res.json({ success: true, ...(await listWorkspaces(req.auth.userId, query)) });
}

export async function getWorkspaceController(req: Request, res: Response) {
  const workspace = await getWorkspace(req.auth.userId, routeParam(req, 'id'));
  res.json({ success: true, data: workspace });
}

export async function updateWorkspaceController(req: Request, res: Response) {
  const workspace = await updateWorkspace(req.auth.userId, routeParam(req, 'id'), req.body);
  res.json({ success: true, data: workspace });
}

export async function archiveWorkspaceController(req: Request, res: Response) {
  const workspace = await archiveWorkspace(req.auth.userId, routeParam(req, 'id'));
  res.json({ success: true, data: workspace });
}

export async function restoreWorkspaceController(req: Request, res: Response) {
  const workspace = await restoreWorkspace(req.auth.userId, routeParam(req, 'id'));
  res.json({ success: true, data: workspace });
}

export async function listWorkspaceMembersController(req: Request, res: Response) {
  const query = parseWorkspacePaginationQuery(req.query);
  const workspaceId = routeParam(req, 'id');
  const result = await listWorkspaceMembers(req.auth.userId, workspaceId, query);
  res.json({
    success: true,
    ...result,
  });
}

export async function transferWorkspaceOwnerController(req: Request, res: Response) {
  const workspaceId = routeParam(req, 'id');
  const memberId = routeParam(req, 'userId');
  await transferWorkspaceOwner(req.auth.userId, workspaceId, memberId);
  res.json({ success: true, data: {} });
}

export async function removeWorkspaceMemberController(req: Request, res: Response) {
  const workspaceId = routeParam(req, 'id');
  const memberId = routeParam(req, 'userId');
  await removeWorkspaceMember(req.auth.userId, workspaceId, memberId);
  res.json({ success: true, data: {} });
}

export async function leaveWorkspaceController(req: Request, res: Response) {
  await leaveWorkspace(req.auth.userId, routeParam(req, 'id'));
  res.json({ success: true, data: {} });
}
