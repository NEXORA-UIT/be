import type { Request, Response } from 'express';
import {
  acceptWorkspaceInvitation,
  cancelWorkspaceInvitation,
  inviteWorkspaceMember,
  listWorkspaceInvitations,
  rejectWorkspaceInvitation,
  resendWorkspaceInvitation,
} from '../services/invitation.service.js';

function param(request: Request, name: string) {
  const value = request.params[name];
  if (typeof value !== 'string') throw new Error(`Missing route parameter: ${name}`);
  return value;
}

export async function inviteWorkspaceMemberController(request: Request, response: Response) {
  const invitation = await inviteWorkspaceMember(
    request.auth.userId,
    param(request, 'id'),
    request.body.email,
  );
  response.status(201).json({ success: true, data: invitation });
}

export async function listWorkspaceInvitationsController(request: Request, response: Response) {
  const invitations = await listWorkspaceInvitations(request.auth.userId, param(request, 'id'));
  response.json({ success: true, data: invitations });
}

export async function acceptWorkspaceInvitationController(request: Request, response: Response) {
  const invitation = await acceptWorkspaceInvitation(request.auth.userId, param(request, 'token'));
  response.json({ success: true, data: invitation });
}

export async function rejectWorkspaceInvitationController(request: Request, response: Response) {
  const invitation = await rejectWorkspaceInvitation(request.auth.userId, param(request, 'token'));
  response.json({ success: true, data: invitation });
}

export async function resendWorkspaceInvitationController(request: Request, response: Response) {
  const invitation = await resendWorkspaceInvitation(request.auth.userId, param(request, 'id'));
  response.json({ success: true, data: invitation });
}

export async function cancelWorkspaceInvitationController(request: Request, response: Response) {
  const invitation = await cancelWorkspaceInvitation(
    request.auth.userId,
    param(request, 'id'),
    param(request, 'invitationId'),
  );
  response.json({ success: true, data: invitation });
}
