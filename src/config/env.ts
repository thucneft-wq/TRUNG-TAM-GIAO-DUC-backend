import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1).refine(
    (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
    'DATABASE_URL must use the postgres or postgresql protocol.',
  ),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must contain at least 32 characters.'),
  ADMIN_EMAIL: z.email(),
  ADMIN_PASSWORD_HASH: z.string().min(20, 'ADMIN_PASSWORD_HASH must be a bcrypt hash.'),
  COUNSELOR_EMAIL: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.email().optional(),
  ),
  COUNSELOR_PASSWORD_HASH: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().min(20, 'COUNSELOR_PASSWORD_HASH must be a bcrypt hash.').optional(),
  ),
  COUNSELOR_ID: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().uuid().optional(),
  ),
  MIN_ANALYTICS_SAMPLE_SIZE: z.coerce.number().int().min(1).max(100).default(5),
  WEB_CRUD_ENABLED: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value;
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
      if (['0', 'false', 'no', 'off', ''].includes(normalized)) return false;
      return value;
    },
    z.boolean().default(false),
  ),
  GOOGLE_SHEETS_SYNC_SECRET: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().min(32).optional(),
  ),
  CORS_ORIGINS: z.string().min(1),
}).refine(
  (value) => {
    const configured = [
      value.COUNSELOR_EMAIL,
      value.COUNSELOR_PASSWORD_HASH,
      value.COUNSELOR_ID,
    ].filter(Boolean).length;
    return configured === 0 || configured === 3;
  },
  'COUNSELOR_EMAIL, COUNSELOR_PASSWORD_HASH and COUNSELOR_ID must be configured together.',
);

export interface AppConfig {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  adminEmail: string;
  adminPasswordHash: string;
  counselorEmail?: string;
  counselorPasswordHash?: string;
  counselorId?: string;
  minimumAnalyticsSampleSize: number;
  googleSheetsSyncSecret?: string;
  webCrudEnabled: boolean;
  corsOrigins: string[];
}

export const loadConfig = (source: NodeJS.ProcessEnv = process.env): AppConfig => {
  const parsed = envSchema.parse(source);
  const corsOrigins = parsed.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (corsOrigins.length === 0) {
    throw new Error('CORS_ORIGINS must contain at least one origin.');
  }

  return {
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    jwtSecret: parsed.JWT_SECRET,
    adminEmail: parsed.ADMIN_EMAIL.toLowerCase(),
    adminPasswordHash: parsed.ADMIN_PASSWORD_HASH,
    counselorEmail: parsed.COUNSELOR_EMAIL?.toLowerCase(),
    counselorPasswordHash: parsed.COUNSELOR_PASSWORD_HASH,
    counselorId: parsed.COUNSELOR_ID,
    minimumAnalyticsSampleSize: parsed.MIN_ANALYTICS_SAMPLE_SIZE,
    googleSheetsSyncSecret: parsed.GOOGLE_SHEETS_SYNC_SECRET,
    webCrudEnabled: parsed.WEB_CRUD_ENABLED,
    corsOrigins,
  };
};
