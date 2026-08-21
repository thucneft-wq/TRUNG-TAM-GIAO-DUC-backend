import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/appError.js';

export const createRequireWebCrudEnabled = (enabled: boolean) =>
  (_request: Request, _response: Response, next: NextFunction): void => {
    if (!enabled) {
      next(new AppError(403, 'Web CRUD is disabled for the current plan. Use the Google Sheets integration instead.', 'WEB_CRUD_DISABLED'));
      return;
    }
    next();
  };
