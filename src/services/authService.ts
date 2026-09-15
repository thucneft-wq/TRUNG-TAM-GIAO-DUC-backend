import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { AuthServicePort, InternalRole } from '../types/services.js';
import { AppError } from '../utils/appError.js';

export interface AuthAccount {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: InternalRole;
}

export class AuthService implements AuthServicePort {
  constructor(
    private readonly accounts: AuthAccount[],
    private readonly jwtSecret: string,
  ) {}

  async login(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const account = this.accounts.find(
      (candidate) => candidate.email === normalizedEmail && candidate.role === 'admin',
    ) ?? null;
    const passwordMatches = account
      ? await bcrypt.compare(password, account.passwordHash)
      : false;

    if (!account || !passwordMatches) {
      throw new AppError(401, 'Invalid email or password.', 'INVALID_CREDENTIALS');
    }

    const token = jwt.sign(
      { role: account.role, name: account.name },
      this.jwtSecret,
      { subject: account.id, expiresIn: '8h', issuer: 'digital-twin-backend' },
    );

    return {
      token,
      user: {
        id: account.id,
        name: account.name,
        email: account.email,
        role: account.role,
      },
    };
  }
}
