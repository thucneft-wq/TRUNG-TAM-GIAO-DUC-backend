import type { StudentRepositoryPort } from '../repositories/studentRepository.js';
import type { StudentServicePort } from '../types/services.js';
import type {
  CreateStudentInput,
  StudentAccessScope,
  StudentDto,
  StudentRow,
  StudentStatus,
  UpdateStudentInput,
} from '../types/student.js';
import { AppError } from '../utils/appError.js';

const toIso = (value: Date | string | null): string | null =>
  value === null ? null : new Date(value).toISOString();

const toDateOnly = (value: Date | string | null): string | null =>
  value === null ? null : new Date(value).toISOString().slice(0, 10);

const mapStudent = (row: StudentRow): StudentDto => ({
  id: row.student_id,
  firstName: row.first_name,
  lastName: row.last_name,
  name: `${row.first_name} ${row.last_name}`.trim(),
  gender: row.gender,
  phoneNumber: row.phone_number,
  email: row.email,
  dateOfBirth: toDateOnly(row.date_of_birth),
  status: row.status.toUpperCase() as StudentStatus,
  schoolId: row.school_id,
  addressId: row.address_id,
  assignedCounselorId: row.assigned_counselor_id,
  assignedCounselorName: row.assigned_counselor_name,
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
    return mapStudent(await this.repository.create(input, scope));
  }

  async update(
    id: string,
    input: UpdateStudentInput,
    scope: StudentAccessScope,
  ): Promise<StudentDto> {
    validateScope(scope);
    const row = await this.repository.update(id, input, scope);
    if (!row) throw new AppError(404, 'Student was not found in your access scope.', 'STUDENT_NOT_FOUND');
    return mapStudent(row);
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
    const existing = await this.repository.findByContact(input.email ?? null, input.phoneNumber);
    if (!existing) {
      return { student: mapStudent(await this.repository.create(input, scope)), created: true };
    }

    const updated = await this.repository.update(existing.student_id, {
      firstName: input.firstName,
      lastName: input.lastName,
      gender: input.gender ?? null,
      phoneNumber: input.phoneNumber,
      email: input.email ?? null,
      dateOfBirth: input.dateOfBirth ?? null,
      status: 'ACTIVE',
      schoolId: input.schoolId ?? null,
      addressId: input.addressId ?? null,
    }, scope);
    if (!updated) {
      throw new AppError(404, 'Student could not be synchronized.', 'STUDENT_NOT_FOUND');
    }
    return { student: mapStudent(updated), created: false };
  }
}
