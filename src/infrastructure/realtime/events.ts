import { randomUUID } from 'node:crypto';

export type BoardChangeEvent = {
  boardId: string;
  change: string;
  occurredAt: string;
  eventId: string;
  schemaVersion: 1;
};

type RealtimeGateway = {
  emitBoardChange: (event: BoardChangeEvent) => Promise<void>;
  emitWorkspaceChange: (workspaceId: string, change: string) => Promise<void>;
  emitUserChange: (userId: string, change: 'notifications') => void;
  disconnectSession: (refreshTokenId: string) => Promise<void>;
  disconnectUser: (userId: string) => Promise<void>;
  disconnectBoard: (boardId: string) => Promise<void>;
  disconnectWorkspace: (workspaceId: string) => Promise<void>;
};

let gateway: RealtimeGateway | undefined;

export function registerRealtimeGateway(nextGateway: RealtimeGateway) {
  gateway = nextGateway;
  return () => {
    if (gateway === nextGateway) gateway = undefined;
  };
}

export async function emitBoardChange(boardId: string, change: string) {
  await gateway?.emitBoardChange({
    boardId,
    change,
    occurredAt: new Date().toISOString(),
    eventId: randomUUID(),
    schemaVersion: 1,
  });
}

export function emitUserChange(userId: string, change: 'notifications') {
  gateway?.emitUserChange(userId, change);
}

export async function emitWorkspaceChange(workspaceId: string, change: string) {
  await gateway?.emitWorkspaceChange(workspaceId, change);
}

export async function disconnectRealtimeSession(refreshTokenId: string) {
  await gateway?.disconnectSession(refreshTokenId);
}

export async function disconnectRealtimeUser(userId: string) {
  await gateway?.disconnectUser(userId);
}

export async function disconnectRealtimeBoard(boardId: string) {
  await gateway?.disconnectBoard(boardId);
}

export async function disconnectRealtimeWorkspace(workspaceId: string) {
  await gateway?.disconnectWorkspace(workspaceId);
}
