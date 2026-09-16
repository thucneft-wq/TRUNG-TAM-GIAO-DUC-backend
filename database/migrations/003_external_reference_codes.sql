ALTER TABLE Students
  ADD COLUMN IF NOT EXISTS external_student_id VARCHAR(50);

ALTER TABLE Counselors
  ADD COLUMN IF NOT EXISTS external_counselor_id VARCHAR(50);

CREATE UNIQUE INDEX IF NOT EXISTS uq_students_external_student_id
  ON Students (UPPER(external_student_id))
  WHERE external_student_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_counselors_external_counselor_id
  ON Counselors (UPPER(external_counselor_id))
  WHERE external_counselor_id IS NOT NULL;
