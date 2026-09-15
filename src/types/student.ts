import type { InternalRole } from './services.js';

export const studentStatuses = ['ACTIVE', 'INACTIVE'] as const;
export type StudentStatus = typeof studentStatuses[number];
export const schoolLevels = ['THCS', 'THPT'] as const;
export type SchoolLevel = typeof schoolLevels[number];

export interface StudentAccessScope {
  role: InternalRole;
  counselorId: string | null;
}

export interface StudentRow {
  student_id: string;
  first_name: string;
  last_name: string;
  gender: string | null;
  phone_number: string;
  email: string | null;
  date_of_birth: Date | string | null;
  status: string;
  school_level: SchoolLevel | null;
  school_name: string | null;
  school_id: string | null;
  address_id: string | null;
  assigned_counselor_id: string | null;
  assigned_counselor_name: string | null;
  created_at: Date | string;
  updated_at: Date | string | null;
}

export interface StudentDto {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  gender: string | null;
  phoneNumber: string;
  email: string | null;
  dateOfBirth: string | null;
  status: StudentStatus;
  schoolLevel: SchoolLevel | null;
  schoolName: string | null;
  schoolId: string | null;
  addressId: string | null;
  assignedCounselorId: string | null;
  assignedCounselorName: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface CreateStudentInput {
  firstName: string;
  lastName: string;
  gender?: string | null;
  phoneNumber: string;
  email?: string | null;
  dateOfBirth?: string | null;
  status: StudentStatus;
  schoolLevel?: SchoolLevel | null;
  schoolName?: string | null;
  schoolId?: string | null;
  addressId?: string | null;
  counselorId?: string | null;
}

export type UpdateStudentInput = Partial<Omit<CreateStudentInput, 'counselorId'>>;
