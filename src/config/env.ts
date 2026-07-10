import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGINS: z.string().default('*'),

  // Turso Database (replaces Supabase)
  TURSO_DATABASE_URL: z.string().url({ message: 'TURSO_DATABASE_URL must be a valid URL' }),
  TURSO_AUTH_TOKEN: z.string().min(1, 'TURSO_AUTH_TOKEN is required'),

  // JWT Authentication (replaces Supabase Auth)
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),

  MATCHMAKING_TIMEOUT_MS: z.coerce.number().default(60_000),
  MATCHMAKING_INITIAL_ELO_RANGE: z.coerce.number().default(100),
  MATCHMAKING_MAX_ELO_RANGE: z.coerce.number().default(600),

  DEFAULT_TIME_CONTROL_MINUTES: z.coerce.number().default(10),
  DEFAULT_TIME_CONTROL_INCREMENT_SEC: z.coerce.number().default(5),
  RECONNECT_GRACE_MS: z.coerce.number().default(30_000),

  HTTP_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  HTTP_RATE_LIMIT_MAX: z.coerce.number().default(120),
  SOCKET_MOVE_RATE_LIMIT_PER_SEC: z.coerce.number().default(10),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast and loud — never boot with a half-valid config (e.g. missing secrets).
  console.error('❌ Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const corsOrigins =
  env.CORS_ORIGINS.trim() === '*' ? '*' : env.CORS_ORIGINS.split(',').map((s) => s.trim());
