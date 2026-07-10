import { z } from 'zod';

export const JoinQueueSchema = z.object({
  timeControlMinutes: z.number().int().min(1).max(60),
  incrementSeconds: z.number().int().min(0).max(60),
});

export const CreateRoomSchema = z.object({
  timeControlMinutes: z.number().int().min(1).max(60),
  incrementSeconds: z.number().int().min(0).max(60),
  allowSpectators: z.boolean().default(true),
  maxSpectators: z.number().int().min(0).max(500).default(50),
  password: z.string().min(4).max(32).optional().nullable(),
  rated: z.boolean().default(false),
});

export const JoinRoomSchema = z.object({
  code: z.string().min(4).max(10),
  password: z.string().max(32).optional(),
});

export const SpectateRoomSchema = z.object({
  roomId: z.string().min(4).max(20),
});

export const MakeMoveSchema = z.object({
  roomId: z.string().min(4).max(20),
  from: z.string().regex(/^[a-h][1-8]$/, 'invalid square'),
  to: z.string().regex(/^[a-h][1-8]$/, 'invalid square'),
  promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
  expectedMoveIndex: z.number().int().min(0).optional(),
  clientTimestamp: z.number().optional(),
});

export const RoomActionSchema = z.object({
  roomId: z.string().min(4).max(20),
});

export const DrawResponseSchema = z.object({
  roomId: z.string().min(4).max(20),
  accept: z.boolean(),
});

export const ChatMessageSchema = z.object({
  roomId: z.string().min(4).max(20),
  text: z.string().min(1).max(300),
});

export const ReactionSchema = z.object({
  roomId: z.string().min(4).max(20),
  emoji: z.enum(['👍', '👏', '😮', '😂', '😢', '🔥']),
});

export const CampaignCompleteSchema = z.object({
  levelId: z.string().min(1).max(64),
  moves: z.array(z.string().min(2).max(10)).min(1).max(500), // SAN move list
  playerColor: z.enum(['w', 'b']),
  durationMs: z.number().int().min(0),
  resigned: z.boolean().default(false),
});

export function parseOrError<T>(schema: z.ZodType<T, z.ZodTypeDef, any>, payload: unknown):
  | { ok: true; data: T }
  | { ok: false; message: string } {
  const result = schema.safeParse(payload);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, message: result.error.issues.map((i) => i.message).join('; ') };
}
