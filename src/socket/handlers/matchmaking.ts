import { Server, Socket } from 'socket.io';
import { MatchmakingQueue, QueueEntry } from '../../engine/MatchmakingQueue';
import { roomManager } from '../../engine/RoomManager';
import { PlayerSlot, RoomSettings } from '../../types';
import { ClientEvents, ServerEvents } from '../events';
import { parseOrError, JoinQueueSchema } from '../../utils/validation';
import { logger } from '../../utils/logger';
import { env } from '../../config/env';
import { pickBotForMatch } from '../../bot/botAccountService';
import { registerBotRoom, maybeTriggerBotMove } from '../../bot/botController';

function timeControlKey(minutes: number, incrementSeconds: number) {
  return `${minutes * 60}+${incrementSeconds}`;
}

function buildRoomSettings(minutes: number, incrementSeconds: number): RoomSettings {
  return {
    mode: 'ranked',
    rated: true,
    timeControl: { initialMs: minutes * 60_000, incrementMs: incrementSeconds * 1000 },
    allowSpectators: true,
    maxSpectators: 100,
  };
}

export function createMatchmakingQueue(io: Server): MatchmakingQueue {
  const queue = new MatchmakingQueue(
    (a, b) => onMatchFound(io, a, b),
    (entry) => onQueueTimeout(io, entry),
  );
  return queue;
}

async function onQueueTimeout(io: Server, entry: QueueEntry): Promise<void> {
  if (!env.MATCHMAKING_BOT_FALLBACK_ENABLED) {
    io.to(entry.socketId).emit(ServerEvents.QUEUE_TIMEOUT, {
      message: 'No opponent found in time. Please try again.',
    });
    return;
  }

  try {
    const bot = await pickBotForMatch(entry.elo);
    if (!bot) {
      // Empty pool (e.g. migration not applied yet) - fail open to the
      // original behavior rather than leaving the player with no response.
      io.to(entry.socketId).emit(ServerEvents.QUEUE_TIMEOUT, {
        message: 'No opponent found in time. Please try again.',
      });
      return;
    }

    const botIsWhite = Math.random() < 0.5;

    const humanEntry: QueueEntry = { ...entry };
    const botAsEntry: QueueEntry = {
      userId: bot.id,
      socketId: '', // never used for a bot - see onMatchFound's socket lookup, which no-ops on a bot's empty id
      displayName: bot.displayName,
      elo: bot.elo,
      timeControlKey: entry.timeControlKey,
      joinedAt: Date.now(),
    };

    // `a` is always the bot and `b` is always the human here - do NOT
    // reorder based on botIsWhite. onMatchFound's forceAIsWhite already
    // does the (one, correct) white/black swap; pre-swapping the a/b
    // arguments too double-swaps whenever botIsWhite is false, and bot
    // color silently stops matching what registerBotRoom is told below.
    const room = onMatchFound(io, botAsEntry, humanEntry, { forceAIsWhite: botIsWhite });
    if (!room) return;

    registerBotRoom(room.id, bot.id, botIsWhite ? 'w' : 'b', bot.elo);
    maybeTriggerBotMove(io, room); // covers the bot-plays-White opening move

    logger.info(
      { roomId: room.id, humanUserId: entry.userId, botUserId: bot.id, botElo: bot.elo },
      'matchmaking timed out - paired with a bot',
    );
  } catch (err) {
    logger.error({ err, userId: entry.userId }, 'bot fallback matchmaking failed');
    io.to(entry.socketId).emit(ServerEvents.QUEUE_TIMEOUT, {
      message: 'No opponent found in time. Please try again.',
    });
  }
}

function onMatchFound(
  io: Server,
  a: QueueEntry,
  b: QueueEntry,
  opts?: { forceAIsWhite: boolean },
) {
  const aIsWhite = opts ? opts.forceAIsWhite : Math.random() < 0.5;
  const [whiteEntry, blackEntry] = aIsWhite ? [a, b] : [b, a];

  const white: PlayerSlot = {
    userId: whiteEntry.userId,
    socketId: whiteEntry.socketId || null,
    color: 'w',
    displayName: whiteEntry.displayName,
    elo: whiteEntry.elo,
    connected: true,
    disconnectedAt: null,
  };
  const black: PlayerSlot = {
    userId: blackEntry.userId,
    socketId: blackEntry.socketId || null,
    color: 'b',
    displayName: blackEntry.displayName,
    elo: blackEntry.elo,
    connected: true,
    disconnectedAt: null,
  };

  const settings = buildRoomSettings(
    a.timeControlKey.includes('+') ? Number(a.timeControlKey.split('+')[0]) / 60 : 10,
    a.timeControlKey.includes('+') ? Number(a.timeControlKey.split('+')[1]) : 5,
  );

  const room = roomManager.createRoom(white, black, settings);

  const whiteSocket = whiteEntry.socketId ? io.sockets.sockets.get(whiteEntry.socketId) : undefined;
  const blackSocket = blackEntry.socketId ? io.sockets.sockets.get(blackEntry.socketId) : undefined;
  whiteSocket?.join(room.id);
  blackSocket?.join(room.id);

  const payload = { room: room.publicState(), yourColor: undefined as unknown };
  whiteSocket?.emit(ServerEvents.MATCH_FOUND, { ...payload, yourColor: 'w' });
  blackSocket?.emit(ServerEvents.MATCH_FOUND, { ...payload, yourColor: 'b' });

  logger.info({ roomId: room.id, white: white.userId, black: black.userId }, 'ranked match found');
  return room;
}

export function registerMatchmakingHandlers(io: Server, socket: Socket, queue: MatchmakingQueue) {
  socket.on(ClientEvents.QUEUE_JOIN, (payload: unknown, ack?: (res: any) => void) => {
    const parsed = parseOrError(JoinQueueSchema, payload);
    if (!parsed.ok) return ack?.({ ok: false, error: parsed.message });

    if (roomManager.getActiveRoomForUser(socket.data.userId)) {
      return ack?.({ ok: false, error: 'You already have an active game.' });
    }

    const entry: QueueEntry = {
      userId: socket.data.userId,
      socketId: socket.id,
      displayName: socket.data.profile.display_name,
      elo: socket.data.profile.elo,
      timeControlKey: timeControlKey(parsed.data.timeControlMinutes, parsed.data.incrementSeconds),
      joinedAt: Date.now(),
    };
    queue.enqueue(entry);
    ack?.({ ok: true });
    socket.emit(ServerEvents.QUEUE_JOINED, { timeControlKey: entry.timeControlKey });
  });

  socket.on(ClientEvents.QUEUE_LEAVE, () => {
    queue.dequeue(socket.data.userId);
  });

  socket.on('disconnect', () => {
    queue.dequeue(socket.data.userId);
  });
}
