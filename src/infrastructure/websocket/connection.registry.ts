import type { WebSocket } from 'ws';

export interface SocketSessionMetadata {
  socketId: string;
  userId: string;
  refreshTokenId: string;
  tokenExpiresAt: number;
  isAlive: boolean;
  joinedBoards: Set<string>;
}

export class ConnectionRegistry {
  private readonly socketMetadata = new Map<WebSocket, SocketSessionMetadata>();
  private readonly userSockets = new Map<string, Set<WebSocket>>();
  private readonly boardSockets = new Map<string, Set<WebSocket>>();

  register(
    socket: WebSocket,
    metadata: Omit<SocketSessionMetadata, 'isAlive' | 'joinedBoards'>,
  ): void {
    const entry: SocketSessionMetadata = {
      ...metadata,
      isAlive: true,
      joinedBoards: new Set<string>(),
    };
    this.socketMetadata.set(socket, entry);

    const userSet = this.userSockets.get(metadata.userId) ?? new Set<WebSocket>();
    userSet.add(socket);
    this.userSockets.set(metadata.userId, userSet);
  }

  unregister(socket: WebSocket): SocketSessionMetadata | undefined {
    const metadata = this.socketMetadata.get(socket);
    if (!metadata) return undefined;

    this.socketMetadata.delete(socket);

    const userSet = this.userSockets.get(metadata.userId);
    if (userSet) {
      userSet.delete(socket);
      if (userSet.size === 0) {
        this.userSockets.delete(metadata.userId);
      }
    }

    for (const boardId of metadata.joinedBoards) {
      const boardSet = this.boardSockets.get(boardId);
      if (boardSet) {
        boardSet.delete(socket);
        if (boardSet.size === 0) {
          this.boardSockets.delete(boardId);
        }
      }
    }

    return metadata;
  }

  getMetadata(socket: WebSocket): SocketSessionMetadata | undefined {
    return this.socketMetadata.get(socket);
  }

  setAlive(socket: WebSocket, isAlive: boolean): void {
    const meta = this.socketMetadata.get(socket);
    if (meta) {
      meta.isAlive = isAlive;
    }
  }

  joinBoard(socket: WebSocket, boardId: string): void {
    const meta = this.socketMetadata.get(socket);
    if (!meta) return;

    meta.joinedBoards.add(boardId);

    const boardSet = this.boardSockets.get(boardId) ?? new Set<WebSocket>();
    boardSet.add(socket);
    this.boardSockets.set(boardId, boardSet);
  }

  leaveBoard(socket: WebSocket, boardId: string): void {
    const meta = this.socketMetadata.get(socket);
    if (!meta) return;

    meta.joinedBoards.delete(boardId);

    const boardSet = this.boardSockets.get(boardId);
    if (boardSet) {
      boardSet.delete(socket);
      if (boardSet.size === 0) {
        this.boardSockets.delete(boardId);
      }
    }
  }

  getSocketsInBoard(boardId: string): WebSocket[] {
    const set = this.boardSockets.get(boardId);
    return set ? Array.from(set) : [];
  }

  getSocketsByUser(userId: string): WebSocket[] {
    const set = this.userSockets.get(userId);
    return set ? Array.from(set) : [];
  }

  closeByRefreshTokenId(refreshTokenId: string, code = 4401, reason = 'LOGGED_OUT'): void {
    for (const [socket, meta] of this.socketMetadata.entries()) {
      if (meta.refreshTokenId === refreshTokenId) {
        try {
          socket.close(code, reason);
        } catch {
          socket.terminate();
        }
        this.unregister(socket);
      }
    }
  }

  closeByUserId(userId: string, code = 4401, reason = 'ALL_SESSIONS_LOGGED_OUT'): void {
    const set = this.userSockets.get(userId);
    if (!set) return;

    for (const socket of Array.from(set)) {
      try {
        socket.close(code, reason);
      } catch {
        socket.terminate();
      }
      this.unregister(socket);
    }
  }

  getAllEntries(): [WebSocket, SocketSessionMetadata][] {
    return Array.from(this.socketMetadata.entries());
  }

  get totalConnections(): number {
    return this.socketMetadata.size;
  }
}

export const connectionRegistry = new ConnectionRegistry();
