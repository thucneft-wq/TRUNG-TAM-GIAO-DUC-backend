import type { Pool, PoolClient } from 'pg';
import type {
  CreateStudentInput,
  StudentAccessScope,
  StudentRow,
  UpdateStudentInput,
} from '../types/student.js';

export interface StudentRepositoryPort {
  list(scope: StudentAccessScope): Promise<StudentRow[]>;
  getById(id: string, scope: StudentAccessScope): Promise<StudentRow | null>;
  findByContact(email: string | null, phoneNumber: string): Promise<StudentRow | null>;
  create(input: CreateStudentInput, scope: StudentAccessScope): Promise<StudentRow>;
  update(id: string, input: UpdateStudentInput, scope: StudentAccessScope): Promise<StudentRow | null>;
  deactivate(id: string, scope: StudentAccessScope): Promise<boolean>;
}

const STUDENT_SELECT = `
SELECT
    s.student_id,
    s.first_name,
    s.last_name,
    s.gender,
    s.phone_number,
    s.email,
    s.date_of_birth,
    s.status,
    s.school_id,
    s.address_id,
    assigned.counselor_id AS assigned_counselor_id,
    assigned.counselor_name AS assigned_counselor_name,
    s.created_at,
    s.updated_at
FROM Students s
LEFT JOIN LATERAL (
    SELECT
        car.counselor_id,
        CONCAT_WS(' ', c.first_name, c.last_name) AS counselor_name
    FROM Counselor_Assignments ca
    JOIN Counselor_Assignment_Records car ON car.assignment_id = ca.assignment_id
    JOIN Counselors c ON c.counselor_id = car.counselor_id
    WHERE ca.student_id = s.student_id
      AND UPPER(ca.status) = 'ACTIVE'
      AND UPPER(car.status) = 'ACTIVE'
      AND car.ended_at IS NULL
    ORDER BY car.assigned_at DESC
    LIMIT 1
) assigned ON TRUE
`;

const accessCondition = `
(
  $1::TEXT = 'admin'
  OR EXISTS (
    SELECT 1
    FROM Counselor_Assignments access_assignment
    JOIN Counselor_Assignment_Records access_record
      ON access_record.assignment_id = access_assignment.assignment_id
    WHERE access_assignment.student_id = s.student_id
      AND access_record.counselor_id = $2::UUID
      AND UPPER(access_assignment.status) = 'ACTIVE'
      AND UPPER(access_record.status) = 'ACTIVE'
      AND access_record.ended_at IS NULL
  )
)
`;

const LIST_STUDENTS_SQL = `
${STUDENT_SELECT}
WHERE UPPER(s.status) = 'ACTIVE'
  AND ${accessCondition}
ORDER BY s.last_name, s.first_name
`;

const GET_STUDENT_SQL = `
${STUDENT_SELECT}
WHERE s.student_id = $3::UUID
  AND ${accessCondition}
`;

const UPDATE_STUDENT_SQL = `
UPDATE Students s
SET
    first_name = CASE WHEN $4::BOOLEAN THEN $5::VARCHAR ELSE first_name END,
    last_name = CASE WHEN $6::BOOLEAN THEN $7::VARCHAR ELSE last_name END,
    gender = CASE WHEN $8::BOOLEAN THEN $9::VARCHAR ELSE gender END,
    phone_number = CASE WHEN $10::BOOLEAN THEN $11::VARCHAR ELSE phone_number END,
    email = CASE WHEN $12::BOOLEAN THEN $13::VARCHAR ELSE email END,
    date_of_birth = CASE WHEN $14::BOOLEAN THEN $15::DATE ELSE date_of_birth END,
    status = CASE WHEN $16::BOOLEAN THEN $17::VARCHAR ELSE status END,
    school_id = CASE WHEN $18::BOOLEAN THEN $19::UUID ELSE school_id END,
    address_id = CASE WHEN $20::BOOLEAN THEN $21::UUID ELSE address_id END,
    updated_at = now()
WHERE s.student_id = $3::UUID
  AND ${accessCondition}
RETURNING s.student_id
`;

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const scopeValues = (scope: StudentAccessScope): [string, string | null] => [
  scope.role,
  scope.counselorId,
];

export class PgStudentRepository implements StudentRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async list(scope: StudentAccessScope): Promise<StudentRow[]> {
    const result = await this.pool.query(LIST_STUDENTS_SQL, scopeValues(scope));
    return result.rows as StudentRow[];
  }

  async getById(id: string, scope: StudentAccessScope): Promise<StudentRow | null> {
    const result = await this.pool.query(GET_STUDENT_SQL, [...scopeValues(scope), id]);
    return (result.rows[0] as StudentRow | undefined) ?? null;
  }

  async findByContact(email: string | null, phoneNumber: string): Promise<StudentRow | null> {
    const result = await this.pool.query(`
      ${STUDENT_SELECT}
      WHERE ($1::VARCHAR IS NOT NULL AND LOWER(s.email) = LOWER($1::VARCHAR))
         OR s.phone_number = $2::VARCHAR
      ORDER BY s.created_at DESC
      LIMIT 1
    `, [email, phoneNumber]);
    return (result.rows[0] as StudentRow | undefined) ?? null;
  }

  async create(input: CreateStudentInput, scope: StudentAccessScope): Promise<StudentRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const created = await client.query<{ student_id: string }>(`
        INSERT INTO Students (
          first_name, last_name, gender, phone_number, email,
          date_of_birth, status, school_id, address_id
        )
        VALUES ($1, $2, $3, $4, $5, $6::DATE, $7, $8::UUID, $9::UUID)
        RETURNING student_id
      `, [
        input.firstName,
        input.lastName,
        input.gender ?? null,
        input.phoneNumber,
        input.email ?? null,
        input.dateOfBirth ?? null,
        input.status,
        input.schoolId ?? null,
        input.addressId ?? null,
      ]);
      const studentId = created.rows[0].student_id;
      const counselorId = scope.role === 'counselor' ? scope.counselorId : input.counselorId ?? null;
      if (counselorId) await this.assignStudent(client, studentId, counselorId);
      await client.query('COMMIT');

      const row = await this.getById(studentId, scope);
      if (!row) throw new Error('Created student could not be read in the current access scope.');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async update(
    id: string,
    input: UpdateStudentInput,
    scope: StudentAccessScope,
  ): Promise<StudentRow | null> {
    const result = await this.pool.query(UPDATE_STUDENT_SQL, [
      ...scopeValues(scope),
      id,
      hasOwn(input, 'firstName'), input.firstName ?? null,
      hasOwn(input, 'lastName'), input.lastName ?? null,
      hasOwn(input, 'gender'), input.gender ?? null,
      hasOwn(input, 'phoneNumber'), input.phoneNumber ?? null,
      hasOwn(input, 'email'), input.email ?? null,
      hasOwn(input, 'dateOfBirth'), input.dateOfBirth ?? null,
      hasOwn(input, 'status'), input.status ?? null,
      hasOwn(input, 'schoolId'), input.schoolId ?? null,
      hasOwn(input, 'addressId'), input.addressId ?? null,
    ]);
    if ((result.rowCount ?? 0) === 0) return null;
    return this.getById(id, scope);
  }

  async deactivate(id: string, scope: StudentAccessScope): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const allowed = await client.query<{ student_id: string }>(`
        SELECT s.student_id
        FROM Students s
        WHERE s.student_id = $3::UUID
          AND ${accessCondition}
        FOR UPDATE
      `, [...scopeValues(scope), id]);
      if (allowed.rowCount === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      await client.query(`
        UPDATE Students SET status = 'INACTIVE', updated_at = now()
        WHERE student_id = $1::UUID
      `, [id]);
      await client.query(`
        UPDATE Counselor_Assignment_Records car
        SET status = 'INACTIVE', ended_at = COALESCE(ended_at, now()), updated_at = now()
        FROM Counselor_Assignments ca
        WHERE ca.assignment_id = car.assignment_id
          AND ca.student_id = $1::UUID
          AND UPPER(car.status) = 'ACTIVE'
      `, [id]);
      await client.query(`
        UPDATE Counselor_Assignments
        SET status = 'INACTIVE', updated_at = now()
        WHERE student_id = $1::UUID AND UPPER(status) = 'ACTIVE'
      `, [id]);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async assignStudent(
    client: PoolClient,
    studentId: string,
    counselorId: string,
  ): Promise<void> {
    const assignment = await client.query<{ assignment_id: string }>(`
      INSERT INTO Counselor_Assignments (student_id, status)
      VALUES ($1::UUID, 'ACTIVE')
      RETURNING assignment_id
    `, [studentId]);
    await client.query(`
      INSERT INTO Counselor_Assignment_Records (
        assignment_id, counselor_id, status, assigned_at
      )
      VALUES ($1::UUID, $2::UUID, 'ACTIVE', now())
    `, [assignment.rows[0].assignment_id, counselorId]);
  }
}
