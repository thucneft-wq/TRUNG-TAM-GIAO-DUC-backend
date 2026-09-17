import { z } from 'zod';
import { createCounselorSchema } from './counselorSchemas.js';

const optionalUuid = z.preprocess(
  (value) => value === '' || value === null ? undefined : value,
  z.string().uuid().optional(),
);

const optionalExternalId = z.preprocess(
  (value) => value === '' || value === null ? undefined : value,
  z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).optional(),
);

export const googleSheetsCounselorSchema = createCounselorSchema.extend({
  counselorId: optionalUuid,
  externalCounselorId: optionalExternalId,
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

export const googleSheetsFeedbackSchema = z.object({
  feedbackId: optionalUuid,
  sessionId: optionalUuid,
  bookingId: optionalUuid,
  externalSessionId: optionalExternalId,
  externalBookingId: optionalExternalId,
  externalStudentId: optionalExternalId,
  externalCounselorId: optionalExternalId,
  bookingStartTime: z.preprocess(
    (value) => value === '' || value === null ? undefined : value,
    z.iso.datetime({ offset: true }).optional(),
  ),
  bookingEndTime: z.preprocess(
    (value) => value === '' || value === null ? undefined : value,
    z.iso.datetime({ offset: true }).optional(),
  ),
  bookingStatus: z.string().trim().min(1).max(30).optional(),
  sessionStartedAt: z.preprocess(
    (value) => value === '' || value === null ? undefined : value,
    z.iso.datetime({ offset: true }).optional(),
  ),
  sessionEndedAt: z.preprocess(
    (value) => value === '' || value === null ? undefined : value,
    z.iso.datetime({ offset: true }).optional(),
  ),
  sessionStatus: z.string().trim().min(1).max(30).optional(),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.preprocess(
    (value) => value === '' || value === null ? undefined : value,
    z.string().trim().max(5000).optional(),
  ),
  category: z.preprocess(
    (value) => value === '' || value === null ? undefined : value,
    z.string().trim().max(100).optional(),
  ),
  createdAt: z.preprocess(
    (value) => value === '' || value === null ? undefined : value,
    z.iso.datetime({ offset: true }).optional(),
  ),
}).strict().refine(
  (value) => Boolean(
    value.sessionId || value.bookingId || value.externalSessionId || value.externalBookingId
  ),
  { message: 'Provide an internal or external session/booking identifier.', path: ['sessionId'] },
).refine(
  (value) => !value.externalBookingId || Boolean(
    value.externalStudentId
    && value.externalCounselorId
    && value.bookingStartTime
    && value.bookingEndTime
  ),
  {
    message: 'External booking sync requires Student/Counselor IDs and booking times.',
    path: ['externalBookingId'],
  },
);

export const googleSheetsAssignmentSchema = z.object({
  studentId: optionalUuid,
  externalStudentId: optionalExternalId,
  studentEmail: z.preprocess(
    (value) => value === '' || value === null ? undefined : value,
    z.email().max(225).optional(),
  ),
  studentPhoneNumber: z.preprocess(
    (value) => value === '' || value === null ? undefined : value,
    z.string().trim().min(1).max(20).optional(),
  ),
  counselorId: optionalUuid,
  externalCounselorId: optionalExternalId,
  counselorEmail: z.preprocess(
    (value) => value === '' || value === null ? undefined : value,
    z.email().max(225).optional(),
  ),
  counselorPhoneNumber: z.preprocess(
    (value) => value === '' || value === null ? undefined : value,
    z.string().trim().min(1).max(20).optional(),
  ),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  assignedAt: z.preprocess(
    (value) => value === '' || value === null ? undefined : value,
    z.iso.datetime({ offset: true }).optional(),
  ),
  endedAt: z.preprocess(
    (value) => value === '' || value === null ? undefined : value,
    z.iso.datetime({ offset: true }).optional(),
  ),
  caseWeight: z.coerce.number().positive().max(10).optional(),
}).strict()
  .refine(
    (value) => Boolean(
      value.studentId || value.externalStudentId || value.studentEmail || value.studentPhoneNumber
    ),
    { message: 'Provide a student identifier.', path: ['studentId'] },
  )
  .refine(
    (value) => Boolean(
      value.counselorId
      || value.externalCounselorId
      || value.counselorEmail
      || value.counselorPhoneNumber
    ),
    { message: 'Provide a counselor identifier.', path: ['counselorId'] },
  );

export const googleSheetsStudentReconcileSchema = z.object({
  activeExternalStudentIds: z.array(
    z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  ).max(10000).default([]),
}).strict();

export const googleSheetsCounselorReconcileSchema = z.object({
  activeExternalCounselorIds: z.array(
    z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  ).max(10000).default([]),
}).strict();
