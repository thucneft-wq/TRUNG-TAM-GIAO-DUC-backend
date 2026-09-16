import { z } from 'zod';
import { schoolLevels, studentStatuses } from '../types/student.js';

const nullableUuid = z.string().uuid().nullable().optional();
const nullableDate = z.string().date().nullable().optional();
const nullableExternalId = z.string().trim().min(1).max(50)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
  .nullable()
  .optional();

export const studentIdSchema = z.string().uuid();

export const createStudentSchema = z.object({
  externalStudentId: nullableExternalId,
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  gender: z.string().trim().max(20).nullable().optional(),
  phoneNumber: z.string().trim().min(1).max(20),
  email: z.email().max(225).nullable().optional(),
  dateOfBirth: nullableDate,
  status: z.enum(studentStatuses).default('ACTIVE'),
  schoolLevel: z.enum(schoolLevels).nullable().optional(),
  schoolName: z.string().trim().min(1).max(225).nullable().optional(),
  schoolId: nullableUuid,
  addressId: nullableUuid,
  counselorId: nullableUuid,
}).strict();

export const updateStudentSchema = createStudentSchema
  .omit({ counselorId: true })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one allowed field is required.');
