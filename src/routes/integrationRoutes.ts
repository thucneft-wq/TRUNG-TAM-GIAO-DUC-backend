import { Router } from 'express';
import type { StudentController } from '../controllers/studentController.js';
import type { GoogleSheetsController } from '../controllers/googleSheetsController.js';
import { createGoogleSheetsAuthMiddleware } from '../middleware/googleSheetsAuth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const createIntegrationRouter = (
  studentController: StudentController,
  googleSheetsController: GoogleSheetsController,
  googleSheetsSyncSecret?: string,
): Router => {
  const router = Router();
  router.post(
    '/google-sheets/students',
    createGoogleSheetsAuthMiddleware(googleSheetsSyncSecret),
    asyncHandler(studentController.syncFromGoogleSheets),
  );
  router.post(
    '/google-sheets/students/reconcile',
    createGoogleSheetsAuthMiddleware(googleSheetsSyncSecret),
    asyncHandler(studentController.reconcileFromGoogleSheets),
  );
  router.post(
    '/google-sheets/counselors',
    createGoogleSheetsAuthMiddleware(googleSheetsSyncSecret),
    asyncHandler(googleSheetsController.syncCounselor),
  );
  router.post(
    '/google-sheets/counselor-accounts',
    createGoogleSheetsAuthMiddleware(googleSheetsSyncSecret),
    asyncHandler(googleSheetsController.syncCounselorAccount),
  );
  router.post(
    '/google-sheets/assignments',
    createGoogleSheetsAuthMiddleware(googleSheetsSyncSecret),
    asyncHandler(studentController.syncAssignmentFromGoogleSheets),
  );
  router.post(
    '/google-sheets/feedbacks',
    createGoogleSheetsAuthMiddleware(googleSheetsSyncSecret),
    asyncHandler(googleSheetsController.syncFeedback),
  );
  return router;
};
