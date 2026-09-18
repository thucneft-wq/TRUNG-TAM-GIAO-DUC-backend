import { Router } from 'express';
import type { AnalyticsController } from '../controllers/analyticsController.js';
import type { CounselorController } from '../controllers/counselorController.js';
import type { DashboardController } from '../controllers/dashboardController.js';
import type { SheetMirrorController } from '../controllers/sheetMirrorController.js';
import { requireRole } from '../middleware/authenticate.js';
import { createRequireWebCrudEnabled } from '../middleware/featureAccess.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const createAdminRouter = (
  counselorController: CounselorController,
  dashboardController: DashboardController,
  analyticsController: AnalyticsController,
  webCrudEnabled = true,
  sheetMirrorController?: SheetMirrorController,
): Router => {
  const router = Router();
  const requireWebCrudEnabled = createRequireWebCrudEnabled(webCrudEnabled);

  router.get('/dashboard', asyncHandler(dashboardController.get));
  router.get('/analytics/filters', asyncHandler(analyticsController.filters));
  router.get('/analytics/student-trends', asyncHandler(analyticsController.studentTrends));
  router.get('/analytics/feedback', asyncHandler(analyticsController.feedback));
  router.get('/analytics/export', asyncHandler(analyticsController.export));
  router.get('/audit-logs', requireRole('admin'), asyncHandler(analyticsController.auditLogs));
  router.get('/counselors', asyncHandler(counselorController.list));
  router.get('/counselors/:id', asyncHandler(counselorController.getById));
  if (sheetMirrorController) {
    router.get('/sheet-mirror/:table', asyncHandler(sheetMirrorController.readTable));
  }
  router.post('/counselors', requireRole('admin'), requireWebCrudEnabled, asyncHandler(counselorController.create));
  router.patch('/counselors/:id', requireRole('admin'), requireWebCrudEnabled, asyncHandler(counselorController.update));
  router.delete('/counselors/:id', requireRole('admin'), requireWebCrudEnabled, asyncHandler(counselorController.deactivate));

  return router;
};
