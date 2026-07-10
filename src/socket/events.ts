export const ClientEvents = {
  // Matchmaking
  QUEUE_JOIN: 'queue:join',
  QUEUE_LEAVE: 'queue:leave',

  // Custom rooms
  ROOM_CREATE: 'room:create',
  ROOM_JOIN: 'room:join',
  ROOM_LEAVE: 'room:leave',
  ROOM_REMATCH_REQUEST: 'room:rematch_request',
  ROOM_REMATCH_RESPOND: 'room:rematch_respond',

  // Spectator
  SPECTATE_JOIN: 'spectate:join',
  SPECTATE_LEAVE: 'spectate:leave',

  // Gameplay
  GAME_MOVE: 'game:move',
  GAME_RESIGN: 'game:resign',
  GAME_DRAW_OFFER: 'game:draw_offer',
  GAME_DRAW_RESPOND: 'game:draw_respond',
  GAME_SYNC_REQUEST: 'game:sync_request',

  // Chat / reactions
  CHAT_MESSAGE: 'chat:message',
  CHAT_REACTION: 'chat:reaction',
} as const;

export const ServerEvents = {
  // Matchmaking
  QUEUE_JOINED: 'queue:joined',
  QUEUE_TIMEOUT: 'queue:timeout',
  MATCH_FOUND: 'match:found',

  // Rooms
  ROOM_CREATED: 'room:created',
  ROOM_JOINED: 'room:joined',
  ROOM_STATE: 'room:state',
  ROOM_REMATCH_OFFERED: 'room:rematch_offered',
  ROOM_ERROR: 'room:error',

  // Spectator
  SPECTATE_STATE: 'spectate:state',
  SPECTATE_ERROR: 'spectate:error',

  // Gameplay
  GAME_STATE: 'game:state',
  GAME_MOVE_APPLIED: 'game:move_applied',
  GAME_OVER: 'game:over',
  GAME_ERROR: 'game:error',

  // Chat
  CHAT_MESSAGE_RECEIVED: 'chat:message_received',
  CHAT_REACTION_RECEIVED: 'chat:reaction_received',

  // Generic
  ERROR: 'error',
} as const;
