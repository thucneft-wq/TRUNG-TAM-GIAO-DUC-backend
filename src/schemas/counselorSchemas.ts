import { z } from 'zod';

export const counselorStatuses = ['ACTIVE', 'INACTIVE', 'ON_LEAVE'] as const;

const nullableShortText = z.string().trim().max(225).nullable().optional();
const dateSchema = z.string().date().nullable().optional();

export const counselorIdSchema = z.string().uuid();

export const periodSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === '') return 'this_month';
    return String(value).replaceAll('-', '_');
  },
  z.enum(['this_month', 'last_month', 'all_time']),
);

export const createCounselorSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  gender: z.string().trim().max(20).nullable().optional(),
  phoneNumber: z.string().trim().max(20).nullable().optional(),
  email: z.email().max(225).nullable().optional(),
  dateOfBirth: dateSchema,
  role: z.string().trim().max(30).nullable().optional(),
  specialization: nullableShortText,
  status: z.enum(counselorStatuses).default('ACTIVE'),
}).strict();

export const updateCounselorSchema = createCounselorSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one allowed field is required.');
