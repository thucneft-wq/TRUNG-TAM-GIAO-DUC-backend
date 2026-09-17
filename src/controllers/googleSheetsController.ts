import type { Request, Response } from 'express';
import {
  googleSheetsCounselorAccountSchema,
  googleSheetsCounselorReconcileSchema,
  googleSheetsCounselorSchema,
  googleSheetsFeedbackSchema,
} from '../schemas/googleSheetsSchemas.js';
import type {
  AnalyticsServicePort,
  CounselorAccountServicePort,
  CounselorServicePort,
  FeedbackServicePort,
} from '../types/services.js';

export class GoogleSheetsController {
  constructor(
    private readonly counselorService: CounselorServicePort,
    private readonly counselorAccountService: CounselorAccountServicePort,
    private readonly analyticsService: AnalyticsServicePort,
    private readonly feedbackService: FeedbackServicePort,
  ) {}

  syncCounselor = async (request: Request, response: Response): Promise<void> => {
    const input = googleSheetsCounselorSchema.parse(request.body);
    const result = await this.counselorService.syncFromGoogleSheets(input);
    await this.analyticsService.recordAudit(
      'google-sheets',
      result.created ? 'SYNC_CREATE_COUNSELOR' : 'SYNC_UPDATE_COUNSELOR',
      'Counselor',
      result.counselor.id,
    );
    response.status(result.created ? 201 : 200).json(result);
  };

  syncCounselorAccount = async (request: Request, response: Response): Promise<void> => {
    const input = googleSheetsCounselorAccountSchema.parse(request.body);
    const account = await this.counselorAccountService.syncFromGoogleSheets(input);
    await this.analyticsService.recordAudit(
      'google-sheets',
      account.created ? 'SYNC_CREATE_COUNSELOR_ACCOUNT' : 'SYNC_UPDATE_COUNSELOR_ACCOUNT',
      'User',
      account.userId,
    );
    response.status(account.created ? 201 : 200).json({ account });
  };

  reconcileCounselors = async (request: Request, response: Response): Promise<void> => {
    const input = googleSheetsCounselorReconcileSchema.parse(request.body);
    const result = await this.counselorService.reconcileFromGoogleSheets(
      input.activeExternalCounselorIds,
      input.dryRun,
    );
    await this.analyticsService.recordAudit(
      'google-sheets',
      'SYNC_RECONCILE_COUNSELORS',
      'Counselor',
      null,
    );
    response.status(200).json(result);
  };

  syncFeedback = async (request: Request, response: Response): Promise<void> => {
    const input = googleSheetsFeedbackSchema.parse(request.body);
    const feedback = await this.feedbackService.syncFromGoogleSheets(input);
    await this.analyticsService.recordAudit(
      'google-sheets',
      feedback.created ? 'SYNC_CREATE_FEEDBACK' : 'SYNC_UPDATE_FEEDBACK',
      'Feedback',
      feedback.feedbackId,
    );
    response.status(feedback.created ? 201 : 200).json({ feedback });
  };
}
