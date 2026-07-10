import express from 'express';
import { createServer } from 'http';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { env, corsOrigins } from './config/env';
import { logger } from './utils/logger';
import { httpRateLimiter } from './middleware/rateLimiter';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { authRouter } from './routes/auth.routes';
import { matchesRouter } from './routes/matches.routes';
import { campaignRouter } from './routes/campaign.routes';
import { healthRouter } from './routes/health.routes';
import { adminRouter } from './routes/admin.routes';
import { adminLevelsRouter } from './routes/admin-levels.routes';
import { createSocketServer } from './socket/index';

const app = express();

app.use(helmet());
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: '256kb' })); // campaign move lists are the largest payload; 256kb is generous
app.use(pinoHttp({ logger }));
app.use(httpRateLimiter);

app.get('/', (_req, res) => res.json({ name: 'chess-online-backend', status: 'ok' }));
app.use('/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/matches', matchesRouter);
app.use('/api/campaign', campaignRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin/levels', adminLevelsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const httpServer = createServer(app);
createSocketServer(httpServer);

httpServer.listen(env.PORT, () => {
  logger.info(`🚀 chess-online-backend listening on port ${env.PORT} (${env.NODE_ENV})`);
});

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down...`);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
