import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/appError.js';

const isDatabaseError = (error: unknown): error is { code: string } =>
  typeof error === 'object' && error !== null && 'code' in error &&
  typeof (error as { code?: unknown }).code === 'string';

const isJsonSyntaxError = (error: unknown): error is SyntaxError & { status: number } =>
  error instanceof SyntaxError &&
  'status' in error &&
  (error as { status?: unknown }).status === 400;

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(new AppError(404, `Route ${request.method} ${request.path} was not found.`, 'ROUTE_NOT_FOUND'));
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (isJsonSyntaxError(error)) {
    response.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Request body must contain valid JSON.',
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
    return;
  }

  if (isDatabaseError(error) && error.code === '23505') {
    response.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'A record with the same unique value already exists.',
      },
    });
    return;
  }

  console.error('Unhandled API error', error);
  response.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected server error occurred.',
    },
  });
};
