import { Server as HttpServer } from 'http';
import { DefaultEventsMap, Server } from 'socket.io';
import { corsOrigins } from '../config/env';
import { AuthedSocketData, socketAuthMiddleware } from './authMiddleware';
import { createMatchmakingQueue, registerMatchmakingHandlers } from './handlers/matchmaking';
import { registerRoomHandlers, cleanupExpiredPendingRooms } from './handlers/room';
import { registerGameHandlers } from './handlers/game';
import { registerSpectatorHandlers } from './handlers/spectator';
import { registerChatHandlers } from './handlers/chat';
import { roomManager } from '../engine/RoomManager';
import { persistFinishedMatch } from '../services/matchService';
import { logger } from '../utils/logger';

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, AuthedSocketData>(
    httpServer,
    {
      cors: { origin: corsOrigins, credentials: true },
      // Keep payloads small and rely on the reconnect+sync flow rather than long-poll buffering.
      maxHttpBufferSize: 1e5,
    },
  );

  io.use(socketAuthMiddleware);

  const matchmakingQueue = createMatchmakingQueue(io);

  io.on('connection', (socket) => {
    logger.info({ userId: socket.data.userId, socketId: socket.id }, 'socket connected');

    registerMatchmakingHandlers(io, socket, matchmakingQueue);
    registerRoomHandlers(io, socket);
    registerGameHandlers(io, socket);
    registerSpectatorHandlers(io, socket);
    registerChatHandlers(io, socket);

    socket.on('disconnect', (reason) => {
      logger.info({ userId: socket.data.userId, reason }, 'socket disconnected');
    });
  });

  // Global tick loop: matchmaking pairing/timeouts, clock-flag timeouts for rooms
  // no one has moved in recently, and pending custom-room expiry. All of this must
  // happen server-side on a timer — never rely on a client telling us "I flagged".
  setInterval(() => {
    matchmakingQueue.tick();
    cleanupExpiredPendingRooms();

    for (const room of roomManager.allActiveRooms()) {
      if (room.checkTimeout()) {
        io.to(room.id).emit('game:over', {
          roomId: room.id,
          result: room.result,
          pgn: room.pgn(),
          finalFen: room.fen(),
        });
        if (room.settings.mode !== 'campaign') {
          persistFinishedMatch(room).catch((err) =>
            logger.error({ err, roomId: room.id }, 'failed to persist timed-out match'),
          );
        }
      }
    }
  }, 1000);

  return io;
}
