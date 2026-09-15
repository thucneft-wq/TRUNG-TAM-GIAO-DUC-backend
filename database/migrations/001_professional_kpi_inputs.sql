-- Additive inputs for workload-aware professional KPI calculation.
-- Existing rows remain compatible: 1.00 FTE and standard case weight 1.00.

ALTER TABLE Counselors
    ADD COLUMN IF NOT EXISTS fte_ratio NUMERIC(4, 2) NOT NULL DEFAULT 1.00;

ALTER TABLE Counselor_Assignment_Records
    ADD COLUMN IF NOT EXISTS case_weight NUMERIC(4, 2) NOT NULL DEFAULT 1.00;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_counselors_fte_ratio'
    ) THEN
        ALTER TABLE Counselors
            ADD CONSTRAINT ck_counselors_fte_ratio
            CHECK (fte_ratio > 0 AND fte_ratio <= 1);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_assignment_case_weight'
    ) THEN
        ALTER TABLE Counselor_Assignment_Records
            ADD CONSTRAINT ck_assignment_case_weight
            CHECK (case_weight >= 0.5 AND case_weight <= 3);
    END IF;
END
$$;

COMMENT ON COLUMN Counselors.fte_ratio IS
    'Full-time equivalent used to normalize professional caseload; 1.00 is full time.';
COMMENT ON COLUMN Counselor_Assignment_Records.case_weight IS
    'Case complexity weight: suggested 1 standard, 1.5 moderate, 2-3 high/crisis.';
