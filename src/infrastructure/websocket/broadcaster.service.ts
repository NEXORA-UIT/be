import { randomUUID } from 'node:crypto';
import { prisma } from '../database/prisma.js';
import { connectionRegistry } from './connection.registry.js';
import type { RealtimeEnvelope, RealtimeEventType, RealtimeActor } from './websocket.types.js';

export type UserOrActor = string | RealtimeActor;

export async function resolveActor(actorOrUserId: UserOrActor): Promise<RealtimeActor> {
  if (typeof actorOrUserId === 'object' && actorOrUserId.userId) {
    return {
      userId: actorOrUserId.userId,
      fullName: actorOrUserId.fullName || 'Thành viên',
    };
  }
  const userId = typeof actorOrUserId === 'string' ? actorOrUserId : actorOrUserId.userId;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
  return {
    userId,
    fullName: user?.fullName || 'Thành viên',
  };
}

export interface BroadcastEventOptions<T> {
  boardId: string;
  event: RealtimeEventType;
  actor: RealtimeActor;
  data: T;
  occurredAt?: string;
}

export function broadcastToBoard<T>(options: BroadcastEventOptions<T>): void {
  queueMicrotask(() => {
    try {
      const envelope: RealtimeEnvelope<T> = {
        event: options.event,
        eventId: randomUUID(),
        occurredAt: options.occurredAt ?? new Date().toISOString(),
        boardId: options.boardId,
        actor: options.actor,
        data: options.data,
      };

      const payload = JSON.stringify(envelope);
      const sockets = connectionRegistry.getSocketsInBoard(options.boardId);

      for (const socket of sockets) {
        try {
          if (socket.readyState === 1 /* OPEN */) {
            socket.send(payload, (error) => {
              if (error) {
                console.error(`[Broadcaster] Socket write error to board ${options.boardId}:`, error.message);
              }
            });
          }
        } catch (socketError: any) {
          console.error(`[Broadcaster] Failed to dispatch to socket:`, socketError?.message);
        }
      }
    } catch (syncError: any) {
      console.error(`[Broadcaster] Sync error broadcasting to board ${options.boardId}:`, syncError?.message);
    }
  });
}
