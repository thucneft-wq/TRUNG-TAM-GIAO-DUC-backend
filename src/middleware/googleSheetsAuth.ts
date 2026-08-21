import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { AppError } from '../utils/appError.js';

export const createGoogleSheetsAuthMiddleware = (configuredSecret?: string): RequestHandler => (
  request,
  _response,
  next,
) => {
  if (!configuredSecret) {
    next(new AppError(503, 'Google Sheets synchronization is not configured.', 'INTEGRATION_NOT_CONFIGURED'));
    return;
  }

  const providedSecret = request.header('x-google-sync-secret') ?? '';
  const expected = Buffer.from(configuredSecret);
  const provided = Buffer.from(providedSecret);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    next(new AppError(401, 'Google Sheets synchronization secret is invalid.', 'INVALID_SYNC_SECRET'));
    return;
  }
  next();
};
