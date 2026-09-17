import type { InternalRole } from './services.js';

export const studentStatuses = [
  'PENDING_REVIEW',
  'ACTIVE',
  'COMPLETED',
  'INACTIVE',
  'REJECTED',
] as const;
export type StudentStatus = typeof studentStatuses[number];
export const schoolLevels = ['THCS', 'THPT'] as const;
export type SchoolLevel = typeof schoolLevels[number];

export interface StudentAccessScope {
  role: InternalRole;
  counselorId: string | null;
}

export interface StudentRow {
  student_id: string;
  external_student_id: string | null;
  first_name: string;
  last_name: string;
  gender: string | null;
  phone_number: string;
  email: string | null;
  parent_phone_number: string | null;
  parent_email: string | null;
  date_of_birth: Date | string | null;
  status: string;
  school_level: SchoolLevel | null;
  school_name: string | null;
  school_id: string | null;
  address_id: string | null;
  assigned_counselor_id: string | null;
  assigned_counselor_external_id: string | null;
  assigned_counselor_name: string | null;
  assignment_status: string | null;
  assignment_ended_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string | null;
}

export interface StudentDto {
  id: string;
  externalId: string | null;
  firstName: string;
  lastName: string;
  name: string;
  gender: string | null;
  phoneNumber: string;
  email: string | null;
  parentPhoneNumber: string | null;
  parentEmail: string | null;
  dateOfBirth: string | null;
  status: StudentStatus;
  schoolLevel: SchoolLevel | null;
  schoolName: string | null;
  schoolId: string | null;
  addressId: string | null;
  assignedCounselorId: string | null;
  assignedCounselorExternalId: string | null;
  assignedCounselorName: string | null;
  assignmentStatus: string | null;
  assignmentEndedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface CreateStudentInput {
  externalStudentId?: string | null;
  firstName: string;
  lastName: string;
  gender?: string | null;
  phoneNumber: string;
  email?: string | null;
  parentPhoneNumber?: string | null;
  parentEmail?: string | null;
  dateOfBirth?: string | null;
  status: StudentStatus;
  schoolLevel?: SchoolLevel | null;
  schoolName?: string | null;
  schoolId?: string | null;
  addressId?: string | null;
  counselorId?: string | null;
}

export type UpdateStudentInput = Partial<Omit<CreateStudentInput, 'counselorId'>>;

export interface GoogleSheetsAssignmentInput {
  studentId?: string;
  externalStudentId?: string;
  studentEmail?: string;
  studentPhoneNumber?: string;
  counselorId?: string;
  externalCounselorId?: string;
  counselorEmail?: string;
  counselorPhoneNumber?: string;
  status: 'ACTIVE' | 'INACTIVE';
  assignedAt?: string;
  endedAt?: string;
  caseWeight?: number;
}

export interface StudentAssignmentSyncResult {
  assignmentId: string | null;
  studentId: string;
  counselorId: string;
  status: 'ACTIVE' | 'INACTIVE';
  created: boolean;
}

export interface GoogleSheetsStudentReconcileInput {
  activeExternalStudentIds: string[];
}

export interface StudentReconcileResult {
  deactivatedStudents: number;
  closedAssignments: number;
}
