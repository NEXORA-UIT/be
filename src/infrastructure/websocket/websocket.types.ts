export const REALTIME_EVENTS = {
  CARD_CREATED: 'CARD_CREATED',
  CARD_MOVED: 'CARD_MOVED',
  CARD_UPDATED: 'CARD_UPDATED',
  CARD_ARCHIVED: 'CARD_ARCHIVED',
  CARD_DELETED: 'CARD_DELETED',
  LIST_REORDERED: 'LIST_REORDERED',
  COMMENT_ADDED: 'COMMENT_ADDED',
} as const;

export type RealtimeEventType = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

export const CLIENT_ACTIONS = {
  JOIN_BOARD: 'JOIN_BOARD',
  LEAVE_BOARD: 'LEAVE_BOARD',
} as const;

export type ClientActionType = (typeof CLIENT_ACTIONS)[keyof typeof CLIENT_ACTIONS];

export interface RealtimeActor {
  userId: string;
  fullName: string;
}

export interface RealtimeEnvelope<T = unknown> {
  event: RealtimeEventType;
  eventId: string;
  occurredAt: string;
  boardId: string;
  actor: RealtimeActor;
  data: T;
}

export interface ClientMessage {
  action: ClientActionType;
  boardId: string;
}

export interface ServerErrorMessage {
  event: 'ERROR';
  error: {
    code: string;
    message: string;
  };
}

export interface ServerAckMessage {
  event: 'JOINED_BOARD' | 'LEFT_BOARD';
  boardId: string;
  occurredAt: string;
}

export interface CardMovedPayload {
  cardId: string;
  fromListId: string;
  toListId: string;
  oldPosition: number;
  newPosition: number;
  updatedAt: string;
}

export interface CardArchivedPayload {
  cardId: string;
  listId: string;
  status: 'ARCHIVED';
  isArchived: boolean;
  updatedAt: string;
}

export interface CardDeletedPayload {
  cardId: string;
  listId: string;
  deletedAt: string;
}

export interface ListReorderedPayload {
  listId: string;
  oldPosition: number;
  newPosition: number;
  updatedAt: string;
}

export interface CommentAddedPayload {
  cardId: string;
  comment: unknown;
  commentsCount: number;
}
