import { Router } from 'express';
import type { AuthController } from '../controllers/authController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const createAuthRouter = (controller: AuthController): Router => {
  const router = Router();
  router.post('/login', asyncHandler(controller.login));
  return router;
};
