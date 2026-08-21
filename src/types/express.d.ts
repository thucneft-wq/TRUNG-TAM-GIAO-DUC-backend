import type { JwtPayload } from 'jsonwebtoken';
import type { InternalRole } from './services.js';

declare global {
  namespace Express {
    interface Request {
      auth?: JwtPayload & {
        sub: string;
        role: InternalRole;
      };
    }
  }
}

export {};
