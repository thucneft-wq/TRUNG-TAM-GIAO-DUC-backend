BEGIN;

ALTER TABLE Students
    ADD COLUMN IF NOT EXISTS school_level VARCHAR(10);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_students_school_level'
    ) THEN
        ALTER TABLE Students
            ADD CONSTRAINT ck_students_school_level
            CHECK (school_level IS NULL OR school_level IN ('THCS', 'THPT'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_students_school_level
    ON Students (school_level)
    WHERE UPPER(status) = 'ACTIVE';

COMMIT;
