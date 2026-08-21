import { Router } from 'express';
import type { HealthController } from '../controllers/healthController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const createHealthRouter = (controller: HealthController): Router => {
  const router = Router();
  router.get('/', asyncHandler(controller.get));
  return router;
};
