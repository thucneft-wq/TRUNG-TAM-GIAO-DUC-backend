import type { Request, Response } from 'express';
import {
  googleSheetsCounselorAccountSchema,
  googleSheetsCounselorSchema,
} from '../schemas/googleSheetsSchemas.js';
import type {
  AnalyticsServicePort,
  CounselorAccountServicePort,
  CounselorServicePort,
} from '../types/services.js';

export class GoogleSheetsController {
  constructor(
    private readonly counselorService: CounselorServicePort,
    private readonly counselorAccountService: CounselorAccountServicePort,
    private readonly analyticsService: AnalyticsServicePort,
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
}
