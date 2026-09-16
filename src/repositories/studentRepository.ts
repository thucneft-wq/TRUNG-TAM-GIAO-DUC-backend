import type { Pool, PoolClient } from 'pg';
import type {
  CreateStudentInput,
  GoogleSheetsAssignmentInput,
  StudentAccessScope,
  StudentAssignmentSyncResult,
  StudentRow,
  UpdateStudentInput,
} from '../types/student.js';
import { AppError } from '../utils/appError.js';

export interface StudentRepositoryPort {
  list(scope: StudentAccessScope): Promise<StudentRow[]>;
  getById(id: string, scope: StudentAccessScope): Promise<StudentRow | null>;
  findBySyncIdentifier(
    externalStudentId: string | null,
    email: string | null,
    phoneNumber: string,
  ): Promise<StudentRow | null>;
  create(input: CreateStudentInput, scope: StudentAccessScope): Promise<StudentRow>;
  update(id: string, input: UpdateStudentInput, scope: StudentAccessScope): Promise<StudentRow | null>;
  deactivate(
    id: string,
    scope: StudentAccessScope,
    status?: 'COMPLETED' | 'INACTIVE' | 'REJECTED',
  ): Promise<boolean>;
  /** Ensure the student already has an active assignment, or auto-assign the least-loaded counselor. */
  ensureAutomaticAssignment(studentId: string): Promise<boolean>;
  /** Promote a PENDING_REVIEW student to ACTIVE and optionally assign a specific counselor. */
  approve(studentId: string, counselorId?: string | null): Promise<boolean>;
  /** Soft-reject a PENDING_REVIEW student (status → REJECTED). */
  reject(studentId: string): Promise<boolean>;
  syncAssignment(input: GoogleSheetsAssignmentInput): Promise<StudentAssignmentSyncResult>;
}

const STUDENT_SELECT = `
SELECT
    s.student_id,
    s.external_student_id,
    s.first_name,
    s.last_name,
    s.gender,
    s.phone_number,
    s.email,
    s.date_of_birth,
    s.status,
    s.school_level,
    s.school_id,
    school.school_name,
    s.address_id,
    assigned.counselor_id AS assigned_counselor_id,
    assigned.counselor_name AS assigned_counselor_name,
    assigned.assignment_status,
    assigned.ended_at AS assignment_ended_at,
    s.created_at,
    s.updated_at
FROM Students s
LEFT JOIN Schools school ON school.school_id = s.school_id
LEFT JOIN LATERAL (
    SELECT
        car.counselor_id,
        CONCAT_WS(' ', c.first_name, c.last_name) AS counselor_name,
        car.status AS assignment_status,
        car.ended_at
    FROM Counselor_Assignments ca
    JOIN Counselor_Assignment_Records car ON car.assignment_id = ca.assignment_id
    JOIN Counselors c ON c.counselor_id = car.counselor_id
    WHERE ca.student_id = s.student_id
    ORDER BY
      CASE
        WHEN UPPER(ca.status) = 'ACTIVE'
          AND UPPER(car.status) = 'ACTIVE'
          AND car.ended_at IS NULL THEN 0
        ELSE 1
      END,
      car.assigned_at DESC
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

/**
 * Admins see both PENDING_REVIEW (new from bot/form) and ACTIVE students.
 * Counselors only see ACTIVE students assigned to them.
 * PENDING_REVIEW rows sort first so the review queue is always visible at the top.
 */
const LIST_STUDENTS_SQL = `
${STUDENT_SELECT}
WHERE (
  ($1::TEXT = 'admin' AND UPPER(s.status) IN ('ACTIVE', 'PENDING_REVIEW'))
  OR (UPPER(s.status) = 'ACTIVE' AND ${accessCondition})
)
ORDER BY
  CASE UPPER(s.status) WHEN 'PENDING_REVIEW' THEN 0 ELSE 1 END,
  s.last_name, s.first_name
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
    school_level = CASE WHEN $18::BOOLEAN THEN $19::VARCHAR ELSE school_level END,
    school_id = CASE WHEN $20::BOOLEAN THEN $21::UUID ELSE school_id END,
    address_id = CASE WHEN $22::BOOLEAN THEN $23::UUID ELSE address_id END,
    external_student_id = CASE WHEN $24::BOOLEAN THEN $25::VARCHAR ELSE external_student_id END,
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

const resolveSchoolId = async (
  client: PoolClient,
  schoolId: string | null | undefined,
  schoolName: string | null | undefined,
): Promise<string | null | undefined> => {
  if (schoolId) return schoolId;
  const normalizedName = schoolName?.trim();
  if (!normalizedName) return schoolId;

  await client.query('SELECT pg_advisory_xact_lock(hashtext(lower($1::TEXT)))', [normalizedName]);
  const existing = await client.query<{ school_id: string }>(`
    SELECT school_id
    FROM Schools
    WHERE LOWER(TRIM(school_name)) = LOWER(TRIM($1::VARCHAR))
    ORDER BY created_at
    LIMIT 1
  `, [normalizedName]);
  if (existing.rows[0]) return existing.rows[0].school_id;

  const created = await client.query<{ school_id: string }>(`
    INSERT INTO Schools (school_name)
    VALUES ($1::VARCHAR)
    RETURNING school_id
  `, [normalizedName]);
  return created.rows[0].school_id;
};

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

  async findBySyncIdentifier(
    externalStudentId: string | null,
    email: string | null,
    phoneNumber: string,
  ): Promise<StudentRow | null> {
    const result = await this.pool.query(`
      ${STUDENT_SELECT}
      WHERE ($1::VARCHAR IS NOT NULL AND UPPER(s.external_student_id) = UPPER($1::VARCHAR))
         OR ($2::VARCHAR IS NOT NULL AND LOWER(s.email) = LOWER($2::VARCHAR))
         OR s.phone_number = $3::VARCHAR
      ORDER BY CASE
        WHEN UPPER(s.external_student_id) = UPPER($1::VARCHAR) THEN 0
        ELSE 1
      END, s.created_at DESC
      LIMIT 1
    `, [externalStudentId, email, phoneNumber]);
    return (result.rows[0] as StudentRow | undefined) ?? null;
  }

  async create(input: CreateStudentInput, scope: StudentAccessScope): Promise<StudentRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const resolvedSchoolId = await resolveSchoolId(client, input.schoolId, input.schoolName);
      const created = await client.query<{ student_id: string }>(`
        INSERT INTO Students (
          first_name, last_name, gender, phone_number, email,
          date_of_birth, status, school_level, school_id, address_id,
          external_student_id
        )
        VALUES ($1, $2, $3, $4, $5, $6::DATE, $7, $8, $9::UUID, $10::UUID, $11::VARCHAR)
        RETURNING student_id
      `, [
        input.firstName,
        input.lastName,
        input.gender ?? null,
        input.phoneNumber,
        input.email ?? null,
        input.dateOfBirth ?? null,
        input.status,
        input.schoolLevel ?? null,
        resolvedSchoolId ?? null,
        input.addressId ?? null,
        input.externalStudentId ?? null,
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
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const hasSchoolInput = hasOwn(input, 'schoolId') || hasOwn(input, 'schoolName');
      const resolvedSchoolId = hasSchoolInput
        ? await resolveSchoolId(client, input.schoolId, input.schoolName)
        : undefined;
      const result = await client.query(UPDATE_STUDENT_SQL, [
        ...scopeValues(scope),
        id,
        hasOwn(input, 'firstName'), input.firstName ?? null,
        hasOwn(input, 'lastName'), input.lastName ?? null,
        hasOwn(input, 'gender'), input.gender ?? null,
        hasOwn(input, 'phoneNumber'), input.phoneNumber ?? null,
        hasOwn(input, 'email'), input.email ?? null,
        hasOwn(input, 'dateOfBirth'), input.dateOfBirth ?? null,
        hasOwn(input, 'status'), input.status ?? null,
        hasOwn(input, 'schoolLevel'), input.schoolLevel ?? null,
        hasSchoolInput, resolvedSchoolId ?? null,
        hasOwn(input, 'addressId'), input.addressId ?? null,
        hasOwn(input, 'externalStudentId'), input.externalStudentId ?? null,
      ]);
      if ((result.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query('COMMIT');
      return this.getById(id, scope);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deactivate(
    id: string,
    scope: StudentAccessScope,
    status: 'COMPLETED' | 'INACTIVE' = 'INACTIVE',
  ): Promise<boolean> {
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
        UPDATE Students SET status = $2::VARCHAR, updated_at = now()
        WHERE student_id = $1::UUID
      `, [id, status]);
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

  async syncAssignment(
    input: GoogleSheetsAssignmentInput,
  ): Promise<StudentAssignmentSyncResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const student = await client.query<{ student_id: string }>(`
        SELECT student_id
        FROM Students
        WHERE ($1::UUID IS NOT NULL AND student_id = $1::UUID)
           OR ($2::VARCHAR IS NOT NULL AND UPPER(external_student_id) = UPPER($2::VARCHAR))
           OR ($3::VARCHAR IS NOT NULL AND LOWER(email) = LOWER($3::VARCHAR))
           OR ($4::VARCHAR IS NOT NULL AND phone_number = $4::VARCHAR)
        ORDER BY CASE
          WHEN student_id = $1::UUID THEN 0
          WHEN UPPER(external_student_id) = UPPER($2::VARCHAR) THEN 1
          ELSE 2
        END, created_at DESC
        LIMIT 1
      `, [
        input.studentId ?? null,
        input.externalStudentId ?? null,
        input.studentEmail ?? null,
        input.studentPhoneNumber ?? null,
      ]);
      if (!student.rows[0]) {
        throw new AppError(404, 'Student from assignment sheet was not found.', 'ASSIGNMENT_STUDENT_NOT_FOUND');
      }

      const counselor = await client.query<{ counselor_id: string }>(`
        SELECT counselor_id
        FROM Counselors
        WHERE ($1::UUID IS NOT NULL AND counselor_id = $1::UUID)
           OR ($2::VARCHAR IS NOT NULL AND UPPER(external_counselor_id) = UPPER($2::VARCHAR))
           OR ($3::VARCHAR IS NOT NULL AND LOWER(email) = LOWER($3::VARCHAR))
           OR ($4::VARCHAR IS NOT NULL AND phone_number = $4::VARCHAR)
        ORDER BY CASE
          WHEN counselor_id = $1::UUID THEN 0
          WHEN UPPER(external_counselor_id) = UPPER($2::VARCHAR) THEN 1
          ELSE 2
        END, created_at DESC
        LIMIT 1
      `, [
        input.counselorId ?? null,
        input.externalCounselorId ?? null,
        input.counselorEmail ?? null,
        input.counselorPhoneNumber ?? null,
      ]);
      if (!counselor.rows[0]) {
        throw new AppError(404, 'Counselor from assignment sheet was not found.', 'ASSIGNMENT_COUNSELOR_NOT_FOUND');
      }

      const studentId = student.rows[0].student_id;
      const counselorId = counselor.rows[0].counselor_id;
      if (input.externalStudentId) {
        await client.query(`
          UPDATE Students
          SET external_student_id = $2::VARCHAR, updated_at = now()
          WHERE student_id = $1::UUID
        `, [studentId, input.externalStudentId]);
      }
      if (input.externalCounselorId) {
        await client.query(`
          UPDATE Counselors
          SET external_counselor_id = $2::VARCHAR, updated_at = now()
          WHERE counselor_id = $1::UUID
        `, [counselorId, input.externalCounselorId]);
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1::TEXT))', [studentId]);

      const current = await client.query<{ assignment_id: string }>(`
        SELECT ca.assignment_id
        FROM Counselor_Assignments ca
        JOIN Counselor_Assignment_Records car ON car.assignment_id = ca.assignment_id
        WHERE ca.student_id = $1::UUID
          AND car.counselor_id = $2::UUID
          AND UPPER(ca.status) = 'ACTIVE'
          AND UPPER(car.status) = 'ACTIVE'
          AND car.ended_at IS NULL
        ORDER BY car.assigned_at DESC
        LIMIT 1
        FOR UPDATE OF ca, car
      `, [studentId, counselorId]);
      const currentAssignmentId = current.rows[0]?.assignment_id ?? null;

      if (input.status === 'INACTIVE') {
        if (currentAssignmentId) {
          await client.query(`
            UPDATE Counselor_Assignment_Records
            SET status = 'INACTIVE', ended_at = COALESCE($2::TIMESTAMPTZ, ended_at, now()), updated_at = now()
            WHERE assignment_id = $1::UUID AND UPPER(status) = 'ACTIVE'
          `, [currentAssignmentId, input.endedAt ?? null]);
          await client.query(`
            UPDATE Counselor_Assignments
            SET status = 'INACTIVE', updated_at = now()
            WHERE assignment_id = $1::UUID
          `, [currentAssignmentId]);
        }
        await client.query('COMMIT');
        return {
          assignmentId: currentAssignmentId,
          studentId,
          counselorId,
          status: 'INACTIVE',
          created: false,
        };
      }

      await client.query(`
        UPDATE Counselor_Assignment_Records car
        SET status = 'INACTIVE', ended_at = COALESCE(ended_at, $2::TIMESTAMPTZ, now()), updated_at = now()
        FROM Counselor_Assignments ca
        WHERE ca.assignment_id = car.assignment_id
          AND ca.student_id = $1::UUID
          AND UPPER(car.status) = 'ACTIVE'
          AND car.ended_at IS NULL
          AND ($3::UUID IS NULL OR ca.assignment_id <> $3::UUID)
      `, [studentId, input.assignedAt ?? null, currentAssignmentId]);
      await client.query(`
        UPDATE Counselor_Assignments
        SET status = 'INACTIVE', updated_at = now()
        WHERE student_id = $1::UUID
          AND UPPER(status) = 'ACTIVE'
          AND ($2::UUID IS NULL OR assignment_id <> $2::UUID)
      `, [studentId, currentAssignmentId]);

      let assignmentId = currentAssignmentId;
      let created = false;
      if (assignmentId) {
        await client.query(`
          UPDATE Counselor_Assignment_Records
          SET case_weight = COALESCE($2::NUMERIC, case_weight), updated_at = now()
          WHERE assignment_id = $1::UUID AND counselor_id = $3::UUID
        `, [assignmentId, input.caseWeight ?? null, counselorId]);
      } else {
        const assignment = await client.query<{ assignment_id: string }>(`
          INSERT INTO Counselor_Assignments (student_id, status)
          VALUES ($1::UUID, 'ACTIVE')
          RETURNING assignment_id
        `, [studentId]);
        assignmentId = assignment.rows[0].assignment_id;
        await client.query(`
          INSERT INTO Counselor_Assignment_Records (
            assignment_id, counselor_id, status, assigned_at, case_weight
          )
          VALUES ($1::UUID, $2::UUID, 'ACTIVE', COALESCE($3::TIMESTAMPTZ, now()), COALESCE($4::NUMERIC, 1))
        `, [assignmentId, counselorId, input.assignedAt ?? null, input.caseWeight ?? null]);
        created = true;
      }

      await client.query(`
        UPDATE Students SET status = 'ACTIVE', updated_at = now()
        WHERE student_id = $1::UUID
      `, [studentId]);
      await client.query('COMMIT');
      return { assignmentId, studentId, counselorId, status: 'ACTIVE', created };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async ensureAutomaticAssignment(studentId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1::TEXT))', [studentId]);

      const student = await client.query<{ student_id: string }>(`
        SELECT student_id FROM Students
        WHERE student_id = $1::UUID AND UPPER(status) = 'ACTIVE'
        FOR UPDATE
      `, [studentId]);
      if (!student.rows[0]) {
        await client.query('COMMIT');
        return false;
      }

      const current = await client.query<{ assignment_id: string }>(`
        SELECT ca.assignment_id
        FROM Counselor_Assignments ca
        JOIN Counselor_Assignment_Records car ON car.assignment_id = ca.assignment_id
        WHERE ca.student_id = $1::UUID
          AND UPPER(ca.status) = 'ACTIVE'
          AND UPPER(car.status) = 'ACTIVE'
          AND car.ended_at IS NULL
        LIMIT 1
      `, [studentId]);
      if (current.rows[0]) {
        await client.query('COMMIT');
        return false;
      }

      const counselor = await client.query<{ counselor_id: string }>(`
        SELECT c.counselor_id
        FROM Counselors c
        LEFT JOIN (
          SELECT car.counselor_id, COUNT(*)::INT AS active_cases
          FROM Counselor_Assignment_Records car
          JOIN Counselor_Assignments ca ON ca.assignment_id = car.assignment_id
          WHERE UPPER(car.status) = 'ACTIVE'
            AND car.ended_at IS NULL
            AND UPPER(ca.status) = 'ACTIVE'
          GROUP BY car.counselor_id
        ) load ON load.counselor_id = c.counselor_id
        WHERE UPPER(c.status) = 'ACTIVE'
        ORDER BY COALESCE(load.active_cases, 0), c.created_at, c.counselor_id
        LIMIT 1
        FOR UPDATE OF c SKIP LOCKED
      `);
      if (!counselor.rows[0]) {
        await client.query('COMMIT');
        return false;
      }

      await this.assignStudent(client, studentId, counselor.rows[0].counselor_id);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async approve(studentId: string, counselorId?: string | null): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1::TEXT))', [studentId]);

      const result = await client.query<{ student_id: string }>(`
        UPDATE Students
        SET status = 'ACTIVE', updated_at = now()
        WHERE student_id = $1::UUID AND UPPER(status) = 'PENDING_REVIEW'
        RETURNING student_id
      `, [studentId]);
      if ((result.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      if (counselorId) {
        await this.assignStudent(client, studentId, counselorId);
      }

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async reject(studentId: string): Promise<boolean> {
    const result = await this.pool.query(`
      UPDATE Students
      SET status = 'REJECTED', updated_at = now()
      WHERE student_id = $1::UUID AND UPPER(status) = 'PENDING_REVIEW'
    `, [studentId]);
    return (result.rowCount ?? 0) > 0;
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
