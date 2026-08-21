import { Router } from 'express';
import type { StudentController } from '../controllers/studentController.js';
import { requireRole } from '../middleware/authenticate.js';
import { createRequireWebCrudEnabled } from '../middleware/featureAccess.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const createStudentRouter = (controller: StudentController, webCrudEnabled = true): Router => {
  const router = Router();
  const requireWebCrudEnabled = createRequireWebCrudEnabled(webCrudEnabled);

  router.use(requireRole('admin', 'counselor'));
  router.get('/', asyncHandler(controller.list));
  router.get('/:id', asyncHandler(controller.getById));
  router.post('/', requireWebCrudEnabled, asyncHandler(controller.create));
  router.patch('/:id', requireWebCrudEnabled, asyncHandler(controller.update));
  router.delete('/:id', requireWebCrudEnabled, asyncHandler(controller.deactivate));

  return router;
};
