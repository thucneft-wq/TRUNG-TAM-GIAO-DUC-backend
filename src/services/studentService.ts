import type { StudentRepositoryPort } from '../repositories/studentRepository.js';
import type { StudentServicePort } from '../types/services.js';
import type {
  CreateStudentInput,
  GoogleSheetsAssignmentInput,
  StudentAccessScope,
  StudentAssignmentSyncResult,
  StudentDto,
  StudentRow,
  StudentStatus,
  UpdateStudentInput,
} from '../types/student.js';
import { AppError } from '../utils/appError.js';
import { toDateOnly } from '../utils/dateOnly.js';

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const mapStudent = (row: StudentRow): StudentDto => ({
  id: row.student_id,
  externalId: row.external_student_id,
  firstName: row.first_name,
  lastName: row.last_name,
  name: `${row.first_name} ${row.last_name}`.trim(),
  gender: row.gender,
  phoneNumber: row.phone_number,
  email: row.email,
  dateOfBirth: toDateOnly(row.date_of_birth),
  status: row.status.toUpperCase() as StudentStatus,
  schoolLevel: row.school_level,
  schoolName: row.school_name,
  schoolId: row.school_id,
  addressId: row.address_id,
  assignedCounselorId: row.assigned_counselor_id,
  assignedCounselorExternalId: row.assigned_counselor_external_id,
  assignedCounselorName: row.assigned_counselor_name,
  assignmentStatus: row.assignment_status,
  assignmentEndedAt: toIso(row.assignment_ended_at),
  createdAt: toIso(row.created_at) ?? '',
  updatedAt: toIso(row.updated_at),
});

const validateScope = (scope: StudentAccessScope): void => {
  if (scope.role === 'counselor' && !scope.counselorId) {
    throw new AppError(403, 'Counselor account is not linked to a counselor profile.', 'COUNSELOR_NOT_LINKED');
  }
};

export class StudentService implements StudentServicePort {
  constructor(private readonly repository: StudentRepositoryPort) {}

  async list(scope: StudentAccessScope): Promise<StudentDto[]> {
    validateScope(scope);
    return (await this.repository.list(scope)).map(mapStudent);
  }

  async getById(id: string, scope: StudentAccessScope): Promise<StudentDto> {
    validateScope(scope);
    const row = await this.repository.getById(id, scope);
    if (!row) throw new AppError(404, 'Student was not found in your access scope.', 'STUDENT_NOT_FOUND');
    return mapStudent(row);
  }

  async create(input: CreateStudentInput, scope: StudentAccessScope): Promise<StudentDto> {
    validateScope(scope);
    const created = await this.repository.create(input, scope);
    if (input.status === 'ACTIVE') await this.repository.ensureAutomaticAssignment(created.student_id);
    return mapStudent(await this.repository.getById(created.student_id, scope) ?? created);
  }

  async update(
    id: string,
    input: UpdateStudentInput,
    scope: StudentAccessScope,
  ): Promise<StudentDto> {
    validateScope(scope);
    const row = await this.repository.update(id, input, scope);
    if (!row) throw new AppError(404, 'Student was not found in your access scope.', 'STUDENT_NOT_FOUND');
    if (input.status === 'ACTIVE') await this.repository.ensureAutomaticAssignment(id);
    return mapStudent(await this.repository.getById(id, scope) ?? row);
  }

  async deactivate(id: string, scope: StudentAccessScope): Promise<void> {
    validateScope(scope);
    if (!await this.repository.deactivate(id, scope)) {
      throw new AppError(404, 'Student was not found in your access scope.', 'STUDENT_NOT_FOUND');
    }
  }

  async syncFromGoogleSheets(
    input: CreateStudentInput,
  ): Promise<{ student: StudentDto; created: boolean }> {
    const scope: StudentAccessScope = { role: 'admin', counselorId: null };
    const existing = await this.repository.findBySyncIdentifier(
      input.externalStudentId ?? null,
      input.email ?? null,
      input.phoneNumber,
    );
    if (!existing) {
      const created = await this.repository.create(input, scope);
      if (input.status === 'ACTIVE') await this.repository.ensureAutomaticAssignment(created.student_id);
      return {
        student: mapStudent(await this.repository.getById(created.student_id, scope) ?? created),
        created: true,
      };
    }

    if (input.status === 'COMPLETED' || input.status === 'INACTIVE' || input.status === 'REJECTED') {
      if (!await this.repository.deactivate(existing.student_id, scope, input.status)) {
        throw new AppError(404, 'Student could not be synchronized.', 'STUDENT_NOT_FOUND');
      }
      const deactivated = await this.repository.getById(existing.student_id, scope);
      if (!deactivated) {
        throw new AppError(404, 'Student could not be synchronized.', 'STUDENT_NOT_FOUND');
      }
      return { student: mapStudent(deactivated), created: false };
    }

    const updateInput: UpdateStudentInput = {
      firstName: input.firstName,
      lastName: input.lastName,
      gender: input.gender ?? null,
      phoneNumber: input.phoneNumber,
      email: input.email ?? null,
      dateOfBirth: input.dateOfBirth ?? null,
      status: input.status,
      schoolLevel: input.schoolLevel ?? null,
      schoolName: input.schoolName ?? null,
      schoolId: input.schoolId ?? null,
      addressId: input.addressId ?? null,
    };
    if (input.externalStudentId !== undefined) {
      updateInput.externalStudentId = input.externalStudentId;
    }
    const updated = await this.repository.update(existing.student_id, updateInput, scope);
    if (!updated) {
      throw new AppError(404, 'Student could not be synchronized.', 'STUDENT_NOT_FOUND');
    }
    await this.repository.ensureAutomaticAssignment(existing.student_id);
    return {
      student: mapStudent(await this.repository.getById(existing.student_id, scope) ?? updated),
      created: false,
    };
  }

  async syncAssignmentFromGoogleSheets(
    input: GoogleSheetsAssignmentInput,
  ): Promise<StudentAssignmentSyncResult> {
    return this.repository.syncAssignment(input);
  }
}
