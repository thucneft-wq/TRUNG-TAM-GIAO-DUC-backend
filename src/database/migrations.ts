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
  `);
};
