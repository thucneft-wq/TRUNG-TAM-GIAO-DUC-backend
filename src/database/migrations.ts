import type { Pool } from 'pg';

/**
 * Small, additive migrations that must exist before repositories are created.
 * The statements are idempotent so local Node and Vercel cold starts are safe.
 */
export const runRuntimeMigrations = async (pool: Pool): Promise<void> => {
  await pool.query(`
    ALTER TABLE Students
      ADD COLUMN IF NOT EXISTS external_student_id VARCHAR(50);

    ALTER TABLE Counselors
      ADD COLUMN IF NOT EXISTS external_counselor_id VARCHAR(50);

    ALTER TABLE Bookings
      ADD COLUMN IF NOT EXISTS external_booking_id VARCHAR(50);

    ALTER TABLE Sessions
      ADD COLUMN IF NOT EXISTS external_session_id VARCHAR(50);

    -- Student registrations are accepted immediately. Normalize records left by
    -- the former approval workflow so they enter the automatic assignment queue.
    UPDATE Students
      SET status = 'ACTIVE', updated_at = now()
      WHERE UPPER(status) = 'PENDING_REVIEW';

    -- Preserve assignment history while closing duplicate active parents before
    -- enforcing the invariant at database level.
    WITH ranked_active_assignments AS (
      SELECT assignment_id,
        ROW_NUMBER() OVER (
          PARTITION BY student_id
          ORDER BY updated_at DESC NULLS LAST, created_at DESC, assignment_id DESC
        ) AS position
      FROM Counselor_Assignments
      WHERE UPPER(status) = 'ACTIVE'
    )
    UPDATE Counselor_Assignments ca
      SET status = 'INACTIVE', updated_at = now()
      FROM ranked_active_assignments ranked
      WHERE ca.assignment_id = ranked.assignment_id
        AND ranked.position > 1;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_students_external_student_id
      ON Students (UPPER(external_student_id))
      WHERE external_student_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_counselors_external_counselor_id
      ON Counselors (UPPER(external_counselor_id))
      WHERE external_counselor_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_external_booking_id
      ON Bookings (UPPER(external_booking_id))
      WHERE external_booking_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_external_session_id
      ON Sessions (UPPER(external_session_id))
      WHERE external_session_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS uq_active_assignment_per_student
      ON Counselor_Assignments (student_id)
      WHERE UPPER(status) = 'ACTIVE';
  `);
};
