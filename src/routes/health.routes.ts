import { Router } from 'express';
import { roomManager } from '../engine/RoomManager';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({ status: 'ok', uptimeSec: process.uptime(), ...roomManager.stats() });
});
