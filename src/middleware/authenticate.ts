import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import type { InternalRole } from '../types/services.js';
import { AppError } from '../utils/appError.js';

const internalRoles: readonly InternalRole[] = ['admin', 'counselor'];

export const createAuthenticateMiddleware = (jwtSecret: string): RequestHandler => (
  request,
  _response,
  next,
) => {
  const authorization = request.header('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    next(new AppError(401, 'Authentication is required.', 'AUTHENTICATION_REQUIRED'));
    return;
  }

  const token = authorization.slice('Bearer '.length).trim();

  try {
    const payload = jwt.verify(token, jwtSecret, {
      issuer: 'digital-twin-backend',
    });

    if (
      typeof payload === 'string' ||
      !internalRoles.includes(payload.role as InternalRole) ||
      typeof payload.sub !== 'string'
    ) {
      throw new Error('Invalid admin token payload.');
    }

    request.auth = payload as Express.Request['auth'];
    next();
  } catch {
    next(new AppError(401, 'The authentication token is invalid or expired.', 'INVALID_TOKEN'));
  }
};

export const requireRole = (...allowedRoles: InternalRole[]): RequestHandler => (
  request,
  _response,
  next,
) => {
  if (!request.auth || !allowedRoles.includes(request.auth.role)) {
    next(new AppError(403, 'You do not have permission to perform this action.', 'ROLE_FORBIDDEN'));
    return;
  }
  next();
};
