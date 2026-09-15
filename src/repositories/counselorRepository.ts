import type { Pool } from 'pg';
import type {
  CounselorAnalyticsRow,
  CounselorProfileRow,
  CreateCounselorInput,
  DashboardCountsRow,
  DashboardTrendRow,
  PeriodRange,
  UpdateCounselorInput,
} from '../types/counselor.js';
import type { GoogleSheetsCounselorInput } from '../types/googleSheets.js';
import { AppError } from '../utils/appError.js';

export interface CounselorRepositoryPort {
  listAnalytics(range: PeriodRange): Promise<CounselorAnalyticsRow[]>;
  getAnalyticsById(id: string, range: PeriodRange): Promise<CounselorAnalyticsRow | null>;
  create(input: CreateCounselorInput): Promise<CounselorProfileRow>;
  update(id: string, input: UpdateCounselorInput): Promise<CounselorProfileRow | null>;
  deactivate(id: string): Promise<boolean>;
  syncFromGoogleSheets(
    input: GoogleSheetsCounselorInput,
  ): Promise<{ profile: CounselorProfileRow; created: boolean }>;
  getDashboardCounts(range: PeriodRange): Promise<DashboardCountsRow>;
  getDashboardTrends(range: PeriodRange): Promise<DashboardTrendRow[]>;
}

export const COUNSELOR_ANALYTICS_SQL = `
WITH counselor_scope AS (
    SELECT c.*
    FROM Counselors c
    WHERE ($1::UUID IS NULL OR c.counselor_id = $1::UUID)
      AND (NOT $2::BOOLEAN OR UPPER(c.status) IN ('ACTIVE', 'ON_LEAVE'))
), caseload_cases AS (
    SELECT
        car.counselor_id,
        ca.student_id,
        MAX(car.case_weight)::NUMERIC AS case_weight
    FROM Counselor_Assignment_Records car
    JOIN Counselor_Assignments ca ON ca.assignment_id = car.assignment_id
    WHERE UPPER(car.status) = 'ACTIVE'
      AND car.ended_at IS NULL
      AND UPPER(ca.status) = 'ACTIVE'
    GROUP BY car.counselor_id, ca.student_id
), caseload AS (
    SELECT
        counselor_id,
        COUNT(*)::INT AS assigned_students,
        ROUND(SUM(case_weight), 2) AS weighted_caseload_points
    FROM caseload_cases
    GROUP BY counselor_id
), availability_daily AS (
    SELECT
        a.counselor_id,
        (a.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE AS work_date,
        SUM(EXTRACT(EPOCH FROM (a.end_time - a.start_time)) / 3600.0)::NUMERIC AS registered_hours
    FROM Availability_Slots a
    WHERE a.start_time >= $3::TIMESTAMPTZ
      AND a.start_time < $4::TIMESTAMPTZ
      AND UPPER(a.status) NOT IN ('CANCELLED', 'CANCELED', 'INACTIVE')
    GROUP BY a.counselor_id, (a.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE
), availability_stats AS (
    SELECT
        counselor_id,
        COUNT(*)::INT AS registered_workdays,
        ROUND(SUM(registered_hours), 2) AS registered_hours,
        ROUND(MAX(registered_hours), 2) AS max_daily_hours,
        COUNT(*) FILTER (WHERE registered_hours > 8)::INT AS over_limit_days
    FROM availability_daily
    GROUP BY counselor_id
), availability_weekly AS (
    SELECT
        counselor_id,
        date_trunc('week', work_date)::DATE AS week_start,
        COUNT(*)::INT AS registered_workdays
    FROM availability_daily
    GROUP BY counselor_id, date_trunc('week', work_date)::DATE
), availability_rest_stats AS (
    SELECT
        counselor_id,
        COUNT(*) FILTER (WHERE registered_workdays > 6)::INT AS weeks_without_rest
    FROM availability_weekly
    GROUP BY counselor_id
), session_stats AS (
    SELECT
        b.counselor_id,
        COUNT(s.session_id)::INT AS total_sessions,
        COUNT(s.session_id) FILTER (
            WHERE UPPER(s.status) = 'COMPLETED'
        )::INT AS completed_sessions,
        ROUND(COALESCE(MAX(
            EXTRACT(EPOCH FROM (
                COALESCE(s.ended_at, b.end_time) - COALESCE(s.started_at, b.start_time)
            )) / 3600.0
        ) FILTER (WHERE UPPER(s.status) = 'COMPLETED'), 0), 2) AS max_session_hours,
        COUNT(s.session_id) FILTER (
            WHERE UPPER(s.status) = 'COMPLETED'
              AND COALESCE(s.ended_at, b.end_time) - COALESCE(s.started_at, b.start_time)
                  > INTERVAL '1 hour'
        )::INT AS over_limit_sessions,
        ROUND(COALESCE(SUM(
            EXTRACT(EPOCH FROM (
                COALESCE(s.ended_at, b.end_time) - COALESCE(s.started_at, b.start_time)
            )) / 3600.0
        ) FILTER (WHERE UPPER(s.status) = 'COMPLETED'), 0), 2) AS student_service_hours
    FROM Bookings b
    JOIN Sessions s ON s.booking_id = b.booking_id
    WHERE b.start_time >= $3::TIMESTAMPTZ
      AND b.start_time < $4::TIMESTAMPTZ
      AND b.end_time <= LEAST($4::TIMESTAMPTZ, now())
      AND UPPER(b.status) NOT IN ('CANCELLED', 'CANCELED', 'RESCHEDULED', 'NO_SHOW_STUDENT')
      AND UPPER(s.status) NOT IN ('CANCELLED', 'CANCELED', 'RESCHEDULED', 'NO_SHOW_STUDENT')
    GROUP BY b.counselor_id
), booking_stats AS (
    SELECT
        b.counselor_id,
        COUNT(b.booking_id)::INT AS total_bookings,
        COUNT(b.booking_id) FILTER (
            WHERE UPPER(b.status) = 'COMPLETED'
        )::INT AS completed_bookings,
        COUNT(b.booking_id) FILTER (
            WHERE UPPER(b.status) IN ('PENDING', 'CONFIRMED', 'SCHEDULED')
        )::INT AS pending_bookings,
        COUNT(b.booking_id) FILTER (
            WHERE UPPER(b.status) IN ('CANCELLED', 'CANCELED')
               OR b.cancelled_at IS NOT NULL
        )::INT AS cancelled_bookings
    FROM Bookings b
    WHERE b.start_time >= $3::TIMESTAMPTZ
      AND b.start_time < $4::TIMESTAMPTZ
    GROUP BY b.counselor_id
), test_stats AS (
    SELECT
        ta.counselor_id,
        COUNT(DISTINCT ta.test_assignment_id)::INT AS total_assigned_tests,
        COUNT(DISTINCT CASE
            WHEN r.result_id IS NOT NULL OR UPPER(tat.status) = 'COMPLETED'
            THEN ta.test_assignment_id
        END)::INT AS completed_tests
    FROM Test_Assignments ta
    LEFT JOIN Test_Attempts tat ON tat.test_assignment_id = ta.test_assignment_id
    LEFT JOIN Results r ON r.test_attempt_id = tat.test_attempt_id
    WHERE ta.assigned_at >= $3::TIMESTAMPTZ
      AND ta.assigned_at < $4::TIMESTAMPTZ
      AND UPPER(ta.status) NOT IN (
          'DECLINED', 'WITHDRAWN', 'NOT_REQUIRED', 'CANCELLED', 'CANCELED'
      )
    GROUP BY ta.counselor_id
), feedback_stats AS (
    SELECT
        f.counselor_id,
        ROUND(AVG(f.rating)::NUMERIC, 2) AS satisfaction_score,
        COUNT(f.feedback_id) FILTER (WHERE f.rating IS NOT NULL)::INT AS feedback_count
    FROM Feedbacks f
    WHERE f.rating IS NOT NULL
      AND f.created_at >= $3::TIMESTAMPTZ
      AND f.created_at < $4::TIMESTAMPTZ
    GROUP BY f.counselor_id
)
SELECT
    c.counselor_id,
    c.first_name,
    c.last_name,
    c.gender,
    c.phone_number,
    c.email,
    c.date_of_birth,
    c.role,
    c.specialization,
    c.status,
    c.created_at,
    c.updated_at,
    COALESCE(cl.assigned_students, 0)::INT AS assigned_students,
    COALESCE(cl.weighted_caseload_points, 0)::NUMERIC AS weighted_caseload_points,
    c.fte_ratio::NUMERIC AS fte_ratio,
    COALESCE(ss.student_service_hours, 0)::NUMERIC AS student_service_hours,
    COALESCE(av.registered_workdays, 0)::INT AS registered_workdays,
    COALESCE(av.registered_hours, 0)::NUMERIC AS registered_hours,
    -- Preserve the existing API field names while reporting the new
    -- one-hour-per-session safety limit.
    COALESCE(ss.max_session_hours, 0)::NUMERIC AS max_daily_hours,
    COALESCE(ss.over_limit_sessions, 0)::INT AS over_limit_days,
    COALESCE(ars.weeks_without_rest, 0)::INT AS weeks_without_rest,
    COALESCE(ss.completed_sessions, 0)::INT AS completed_sessions,
    COALESCE(ss.total_sessions, 0)::INT AS total_sessions,
    COALESCE(bs.completed_bookings, 0)::INT AS completed_bookings,
    COALESCE(bs.pending_bookings, 0)::INT AS pending_bookings,
    COALESCE(bs.cancelled_bookings, 0)::INT AS cancelled_bookings,
    COALESCE(bs.total_bookings, 0)::INT AS total_bookings,
    COALESCE(ts.completed_tests, 0)::INT AS completed_tests,
    COALESCE(ts.total_assigned_tests, 0)::INT AS total_assigned_tests,
    fs.satisfaction_score,
    COALESCE(fs.feedback_count, 0)::INT AS feedback_count
FROM counselor_scope c
LEFT JOIN caseload cl ON cl.counselor_id = c.counselor_id
LEFT JOIN availability_stats av ON av.counselor_id = c.counselor_id
LEFT JOIN availability_rest_stats ars ON ars.counselor_id = c.counselor_id
LEFT JOIN session_stats ss ON ss.counselor_id = c.counselor_id
LEFT JOIN booking_stats bs ON bs.counselor_id = c.counselor_id
LEFT JOIN test_stats ts ON ts.counselor_id = c.counselor_id
LEFT JOIN feedback_stats fs ON fs.counselor_id = c.counselor_id
ORDER BY c.last_name, c.first_name
`;

const CREATE_COUNSELOR_SQL = `
INSERT INTO Counselors (
    first_name, last_name, gender, phone_number, email,
    date_of_birth, role, specialization, status, fte_ratio
)
VALUES ($1, $2, $3, $4, $5, $6::DATE, $7, $8, $9, $10)
RETURNING *
`;

export const UPDATE_COUNSELOR_SQL = `
UPDATE Counselors
SET
    first_name = CASE WHEN $2::BOOLEAN THEN $3::VARCHAR ELSE first_name END,
    last_name = CASE WHEN $4::BOOLEAN THEN $5::VARCHAR ELSE last_name END,
    gender = CASE WHEN $6::BOOLEAN THEN $7::VARCHAR ELSE gender END,
    phone_number = CASE WHEN $8::BOOLEAN THEN $9::VARCHAR ELSE phone_number END,
    email = CASE WHEN $10::BOOLEAN THEN $11::VARCHAR ELSE email END,
    date_of_birth = CASE WHEN $12::BOOLEAN THEN $13::DATE ELSE date_of_birth END,
    role = CASE WHEN $14::BOOLEAN THEN $15::VARCHAR ELSE role END,
    specialization = CASE WHEN $16::BOOLEAN THEN $17::VARCHAR ELSE specialization END,
    status = CASE WHEN $18::BOOLEAN THEN $19::VARCHAR ELSE status END,
    fte_ratio = CASE WHEN $20::BOOLEAN THEN $21::NUMERIC ELSE fte_ratio END,
    updated_at = now()
WHERE counselor_id = $1::UUID
RETURNING *
`;

export const DEACTIVATE_COUNSELOR_SQL = `
UPDATE Counselors
SET status = 'INACTIVE',
    updated_at = now()
WHERE counselor_id = $1::UUID
RETURNING counselor_id
`;

const DASHBOARD_COUNTS_SQL = `
SELECT
    (SELECT COUNT(*)::INT FROM Students WHERE UPPER(status) = 'ACTIVE') AS total_students,
    (SELECT COUNT(*)::INT FROM Counselors WHERE UPPER(status) = 'ACTIVE') AS active_counselors,
    (SELECT COUNT(*)::INT FROM Tests WHERE UPPER(status) = 'ACTIVE') AS total_tests,
    (
      SELECT COUNT(*)::INT
      FROM Test_Attempts ta
      WHERE COALESCE(ta.submitted_at, ta.assigned_at, ta.created_at) >= $1::TIMESTAMPTZ
        AND COALESCE(ta.submitted_at, ta.assigned_at, ta.created_at) < $2::TIMESTAMPTZ
    ) AS total_test_attempts,
    COUNT(b.booking_id)::INT AS total_bookings,
    COUNT(b.booking_id) FILTER (WHERE UPPER(b.status) = 'COMPLETED')::INT AS completed_bookings,
    COUNT(b.booking_id) FILTER (
        WHERE UPPER(b.status) IN ('PENDING', 'CONFIRMED', 'SCHEDULED')
    )::INT AS pending_bookings,
    COUNT(b.booking_id) FILTER (
        WHERE UPPER(b.status) IN ('CANCELLED', 'CANCELED') OR b.cancelled_at IS NOT NULL
    )::INT AS cancelled_bookings
FROM Bookings b
WHERE b.start_time >= $1::TIMESTAMPTZ
  AND b.start_time < $2::TIMESTAMPTZ
`;

const DASHBOARD_TRENDS_SQL = `
SELECT
    TO_CHAR(date_trunc('month', b.start_time), 'YYYY-MM') AS period_label,
    COUNT(*) FILTER (WHERE UPPER(b.status) = 'COMPLETED')::INT AS completed_bookings,
    COUNT(*) FILTER (
        WHERE UPPER(b.status) IN ('PENDING', 'CONFIRMED', 'SCHEDULED')
    )::INT AS pending_bookings,
    COUNT(*) FILTER (
        WHERE UPPER(b.status) IN ('CANCELLED', 'CANCELED') OR b.cancelled_at IS NOT NULL
    )::INT AS cancelled_bookings
FROM Bookings b
WHERE b.start_time >= $1::TIMESTAMPTZ
  AND b.start_time < $2::TIMESTAMPTZ
GROUP BY date_trunc('month', b.start_time)
ORDER BY date_trunc('month', b.start_time)
`;

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

export class PgCounselorRepository implements CounselorRepositoryPort {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async listAnalytics(range: PeriodRange): Promise<CounselorAnalyticsRow[]> {
    const result = await this.pool.query(COUNSELOR_ANALYTICS_SQL, [
      null,
      true,
      range.start,
      range.end,
    ]);
    return result.rows as CounselorAnalyticsRow[];
  }

  async getAnalyticsById(id: string, range: PeriodRange): Promise<CounselorAnalyticsRow | null> {
    const result = await this.pool.query(COUNSELOR_ANALYTICS_SQL, [
      id,
      false,
      range.start,
      range.end,
    ]);
    return (result.rows[0] as CounselorAnalyticsRow | undefined) ?? null;
  }

  async create(input: CreateCounselorInput): Promise<CounselorProfileRow> {
    const result = await this.pool.query(CREATE_COUNSELOR_SQL, [
      input.firstName,
      input.lastName,
      input.gender ?? null,
      input.phoneNumber ?? null,
      input.email ?? null,
      input.dateOfBirth ?? null,
      input.role ?? null,
      input.specialization ?? null,
      input.status,
      input.fteRatio ?? 1,
    ]);
    return result.rows[0] as CounselorProfileRow;
  }

  async update(id: string, input: UpdateCounselorInput): Promise<CounselorProfileRow | null> {
    const result = await this.pool.query(UPDATE_COUNSELOR_SQL, [
      id,
      hasOwn(input, 'firstName'), input.firstName ?? null,
      hasOwn(input, 'lastName'), input.lastName ?? null,
      hasOwn(input, 'gender'), input.gender ?? null,
      hasOwn(input, 'phoneNumber'), input.phoneNumber ?? null,
      hasOwn(input, 'email'), input.email ?? null,
      hasOwn(input, 'dateOfBirth'), input.dateOfBirth ?? null,
      hasOwn(input, 'role'), input.role ?? null,
      hasOwn(input, 'specialization'), input.specialization ?? null,
      hasOwn(input, 'status'), input.status ?? null,
      hasOwn(input, 'fteRatio'), input.fteRatio ?? null,
    ]);
    return (result.rows[0] as CounselorProfileRow | undefined) ?? null;
  }

  async deactivate(id: string): Promise<boolean> {
    const result = await this.pool.query(DEACTIVATE_COUNSELOR_SQL, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async syncFromGoogleSheets(
    input: GoogleSheetsCounselorInput,
  ): Promise<{ profile: CounselorProfileRow; created: boolean }> {
    const matched = await this.pool.query<{ counselor_id: string }>(`
      SELECT counselor_id
      FROM Counselors
      WHERE ($1::UUID IS NOT NULL AND counselor_id = $1::UUID)
         OR ($2::VARCHAR IS NOT NULL AND LOWER(email) = LOWER($2::VARCHAR))
         OR ($3::VARCHAR IS NOT NULL AND phone_number = $3::VARCHAR)
      ORDER BY CASE WHEN counselor_id = $1::UUID THEN 0 ELSE 1 END, created_at DESC
      LIMIT 1
    `, [input.counselorId ?? null, input.email ?? null, input.phoneNumber ?? null]);
    const existingId = matched.rows[0]?.counselor_id;
    const profileInput: CreateCounselorInput = {
      firstName: input.firstName,
      lastName: input.lastName,
      gender: input.gender ?? null,
      phoneNumber: input.phoneNumber ?? null,
      email: input.email ?? null,
      dateOfBirth: input.dateOfBirth ?? null,
      role: input.role ?? null,
      specialization: input.specialization ?? null,
      status: input.status,
      fteRatio: input.fteRatio ?? 1,
    };
    if (existingId) {
      const profile = await this.update(existingId, profileInput);
      if (!profile) throw new AppError(404, 'Counselor was not found.', 'COUNSELOR_NOT_FOUND');
      return { profile, created: false };
    }

    if (!input.counselorId) {
      return { profile: await this.create(profileInput), created: true };
    }
    const inserted = await this.pool.query(`
      INSERT INTO Counselors (
        counselor_id, first_name, last_name, gender, phone_number, email,
        date_of_birth, role, specialization, status, fte_ratio
      )
      VALUES ($1::UUID, $2, $3, $4, $5, $6, $7::DATE, $8, $9, $10, $11)
      RETURNING *
    `, [
      input.counselorId,
      profileInput.firstName,
      profileInput.lastName,
      profileInput.gender,
      profileInput.phoneNumber,
      profileInput.email,
      profileInput.dateOfBirth,
      profileInput.role,
      profileInput.specialization,
      profileInput.status,
      profileInput.fteRatio ?? 1,
    ]);
    return { profile: inserted.rows[0] as CounselorProfileRow, created: true };
  }

  async getDashboardCounts(range: PeriodRange): Promise<DashboardCountsRow> {
    const result = await this.pool.query(DASHBOARD_COUNTS_SQL, [range.start, range.end]);
    return result.rows[0] as DashboardCountsRow;
  }

  async getDashboardTrends(range: PeriodRange): Promise<DashboardTrendRow[]> {
    const result = await this.pool.query(DASHBOARD_TRENDS_SQL, [range.start, range.end]);
    return result.rows as DashboardTrendRow[];
  }
}
