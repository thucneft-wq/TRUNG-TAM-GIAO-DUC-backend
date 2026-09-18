import { z } from 'zod';

const REQUIRED_PRODUCTION_CORS_ORIGINS = [
  'https://trung-tam-giao-duc.vercel.app',
];

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1).refine(
    (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
    'DATABASE_URL must use the postgres or postgresql protocol.',
  ),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must contain at least 32 characters.'),
  ADMIN_EMAIL: z.email(),
  ADMIN_PASSWORD_HASH: z.string().min(20, 'ADMIN_PASSWORD_HASH must be a bcrypt hash.'),
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
  WEB_SHEET_API_URL: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.url().optional(),
  ),
  WEB_SHEET_API_KEY: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().min(32).optional(),
  ),
  CORS_ORIGINS: z.string().min(1),
}).refine(
  (value) => Boolean(value.WEB_SHEET_API_URL) === Boolean(value.WEB_SHEET_API_KEY),
  {
    message: 'WEB_SHEET_API_URL and WEB_SHEET_API_KEY must be configured together.',
    path: ['WEB_SHEET_API_URL'],
  },
);

export interface AppConfig {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  adminEmail: string;
  adminPasswordHash: string;
  minimumAnalyticsSampleSize: number;
  googleSheetsSyncSecret?: string;
  webSheetApiUrl?: string;
  webSheetApiKey?: string;
  webCrudEnabled: boolean;
  corsOrigins: string[];
}

export const loadConfig = (source: NodeJS.ProcessEnv = process.env): AppConfig => {
  const parsed = envSchema.parse(source);
  const configuredCorsOrigins = parsed.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const corsOrigins = Array.from(new Set([
    ...configuredCorsOrigins,
    ...REQUIRED_PRODUCTION_CORS_ORIGINS,
  ]));

  if (configuredCorsOrigins.length === 0) {
    throw new Error('CORS_ORIGINS must contain at least one origin.');
  }

  return {
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    jwtSecret: parsed.JWT_SECRET,
    adminEmail: parsed.ADMIN_EMAIL.toLowerCase(),
    adminPasswordHash: parsed.ADMIN_PASSWORD_HASH,
    minimumAnalyticsSampleSize: parsed.MIN_ANALYTICS_SAMPLE_SIZE,
    googleSheetsSyncSecret: parsed.GOOGLE_SHEETS_SYNC_SECRET,
    webSheetApiUrl: parsed.WEB_SHEET_API_URL,
    webSheetApiKey: parsed.WEB_SHEET_API_KEY,
    webCrudEnabled: parsed.WEB_CRUD_ENABLED,
    corsOrigins,
  };
};
