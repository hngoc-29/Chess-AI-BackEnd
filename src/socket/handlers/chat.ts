import { Server, Socket } from 'socket.io';
import { roomManager } from '../../engine/RoomManager';
import { ClientEvents, ServerEvents } from '../events';
import { ChatMessageSchema, ReactionSchema, parseOrError } from '../../utils/validation';
import { SocketEventLimiter } from '../../middleware/rateLimiter';
import { supabaseAdmin } from '../../db/supabase';
import { logger } from '../../utils/logger';

const chatLimiter = new SocketEventLimiter(3, 2000); // max 3 messages / 2s per user

export function registerChatHandlers(io: Server, socket: Socket) {
  socket.on(ClientEvents.CHAT_MESSAGE, (payload: unknown, ack?: (res: any) => void) => {
    const parsed = parseOrError(ChatMessageSchema, payload);
    if (!parsed.ok) return ack?.({ ok: false, error: parsed.message });

    const room = roomManager.get(parsed.data.roomId);
    if (!room) return ack?.({ ok: false, error: 'Room not found.' });

    if (!chatLimiter.allow(socket.data.userId)) {
      return ack?.({ ok: false, error: 'Slow down — sending messages too fast.' });
    }

    const message = {
      roomId: room.id,
      userId: socket.data.userId,
      displayName: socket.data.profile.display_name,
      text: parsed.data.text,
      sentAt: Date.now(),
    };

    io.to(room.id).emit(ServerEvents.CHAT_MESSAGE_RECEIVED, message);
    ack?.({ ok: true });

    supabaseAdmin
      .from('chat_logs')
      .insert({ room_id: room.id, user_id: socket.data.userId, message: parsed.data.text })
      .then(({ error }) => {
        if (error) logger.warn({ err: error }, 'failed to write chat_logs row');
      });
  });

  socket.on(ClientEvents.CHAT_REACTION, (payload: unknown, ack?: (res: any) => void) => {
    const parsed = parseOrError(ReactionSchema, payload);
    if (!parsed.ok) return ack?.({ ok: false, error: parsed.message });
    const room = roomManager.get(parsed.data.roomId);
    if (!room) return ack?.({ ok: false, error: 'Room not found.' });

    io.to(room.id).emit(ServerEvents.CHAT_REACTION_RECEIVED, {
      roomId: room.id,
      userId: socket.data.userId,
      emoji: parsed.data.emoji,
    });
    ack?.({ ok: true });
  });
}
