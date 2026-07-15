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
import { ensureBotPool } from './bot/botAccountService';

const app = express();

// HF Spaces (and most PaaS hosts) put this behind a reverse proxy. Without
// this, Express's req.ip resolves to the proxy's own IP for every request,
// so express-rate-limit below keys ALL users into the same bucket instead
// of one bucket per real client - a handful of concurrent users sharing a
// deploy can trip each other's rate limit. `1` trusts exactly one hop
// (the platform's proxy) and reads the real client IP from X-Forwarded-For.
app.set('trust proxy', 1);

app.use(helmet());
// cors() takes `origin: '*'` literally and echoes back the string "*" in
// Access-Control-Allow-Origin. Per the CORS spec, browsers reject that
// combined with Access-Control-Allow-Credentials: true (which `credentials:
// true` below always sends) on any credentialed request - harmless today
// since the docs-admin client doesn't set withCredentials, but it would
// silently break the moment anything here switches to cookie-based auth.
// `origin: true` reflects the actual request Origin instead, which gives
// the same "allow anyone" behavior while staying spec-valid with credentials.
app.use(cors({ origin: corsOrigins === '*' ? true : corsOrigins, credentials: true }));
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

// Non-blocking: the pool only needs to exist by the time the first
// matchmaking timeout fires (MATCHMAKING_TIMEOUT_MS, 60s by default), so
// there's no need to delay accepting connections for this.
ensureBotPool().catch((err) => {
  logger.error({ err }, 'failed to initialize bot account pool - AI-fallback matchmaking will fail open until this succeeds');
});

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down...`);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
