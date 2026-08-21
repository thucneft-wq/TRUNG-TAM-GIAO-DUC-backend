import { z } from 'zod';
import { createCounselorSchema } from './counselorSchemas.js';

const optionalUuid = z.preprocess(
  (value) => value === '' || value === null ? undefined : value,
  z.string().uuid().optional(),
);

export const googleSheetsCounselorSchema = createCounselorSchema.extend({
  counselorId: optionalUuid,
});

export const googleSheetsCounselorAccountSchema = z.object({
  userId: optionalUuid,
  counselorId: optionalUuid,
  counselorEmail: z.preprocess(
    (value) => value === '' || value === null ? undefined : value,
    z.email().max(225).optional(),
  ),
  email: z.email().max(225),
  password: z.preprocess(
    (value) => value === '' || value === null ? undefined : value,
    z.string().min(8).max(100).optional(),
  ),
  passwordHash: z.preprocess(
    (value) => value === '' || value === null ? undefined : value,
    z.string().regex(/^\$2[aby]\$\d{2}\$.{53}$/, 'passwordHash must be a bcrypt hash.').optional(),
  ),
  status: z.enum([
    'PENDING_VERIFICATION',
    'ACTIVE',
    'LOCKED',
    'SUSPENDED',
    'DISABLED',
  ]).default('ACTIVE'),
}).strict().refine(
  (value) => !(value.password && value.passwordHash),
  'Provide password or passwordHash, not both.',
);
