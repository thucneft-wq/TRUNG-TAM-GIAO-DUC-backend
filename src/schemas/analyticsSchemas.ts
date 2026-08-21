import { z } from 'zod';
import { periodSchema } from './counselorSchemas.js';

const optionalUuid = z.preprocess(
  (value) => value === undefined || value === null || value === '' ? undefined : value,
  z.string().uuid().optional(),
);

const optionalCategory = z.preprocess(
  (value) => value === undefined || value === null || value === '' ? undefined : value,
  z.string().trim().min(1).max(100).optional(),
);

export const analyticsQuerySchema = z.object({
  period: periodSchema,
  counselorId: optionalUuid,
  testId: optionalUuid,
  category: optionalCategory,
}).strict();

export const analyticsExportQuerySchema = analyticsQuerySchema.extend({
  type: z.enum(['overview', 'student_trends', 'feedback']).default('overview'),
}).strict();

export const auditLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();
