import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGINS: z.string().default('*'),

  SUPABASE_URL: z.string().url({ message: 'SUPABASE_URL must be a valid URL' }),
  SUPABASE_ANON_KEY: z.string().min(1, 'SUPABASE_ANON_KEY is required'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),

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
