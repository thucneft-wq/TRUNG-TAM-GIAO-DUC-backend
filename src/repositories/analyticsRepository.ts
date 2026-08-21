import type { Pool } from 'pg';
import type {
  AnalyticsFilterOptions,
  AnalyticsFilters,
  AuditLogRow,
  FeedbackTrendRow,
  StudentTrendRow,
} from '../types/analytics.js';

export interface AnalyticsRepositoryPort {
  getFilterOptions(): Promise<AnalyticsFilterOptions>;
  getStudentTrendRows(filters: AnalyticsFilters): Promise<StudentTrendRow[]>;
  getFeedbackTrendRows(filters: AnalyticsFilters): Promise<FeedbackTrendRow[]>;
  recordAudit(
    actorRole: string,
    action: string,
    entityType: string,
    entityId?: string | null,
  ): Promise<void>;
  listAuditLogs(limit: number): Promise<AuditLogRow[]>;
}

const STUDENT_TRENDS_SQL = `
WITH analytics_events AS (
    SELECT
        date_trunc('month', a.created_at) AS period_bucket,
        'assessment'::TEXT AS source,
        NULLIF(BTRIM(a.assessment_category), '') AS category
    FROM Assessments a
    WHERE a.created_at >= $1::TIMESTAMPTZ
      AND a.created_at < $2::TIMESTAMPTZ
      AND ($3::UUID IS NULL OR a.counselor_id = $3::UUID)
      AND $4::UUID IS NULL

    UNION ALL

    SELECT
        date_trunc('month', COALESCE(ta.submitted_at, r.created_at)) AS period_bucket,
        'test_result'::TEXT AS source,
        NULLIF(BTRIM(r.category), '') AS category
    FROM Results r
    JOIN Test_Attempts ta ON ta.test_attempt_id = r.test_attempt_id
    JOIN Test_Assignments tas ON tas.test_assignment_id = ta.test_assignment_id
    WHERE COALESCE(ta.submitted_at, r.created_at) >= $1::TIMESTAMPTZ
      AND COALESCE(ta.submitted_at, r.created_at) < $2::TIMESTAMPTZ
      AND ($3::UUID IS NULL OR tas.counselor_id = $3::UUID)
      AND ($4::UUID IS NULL OR tas.test_id = $4::UUID)
)
SELECT
    TO_CHAR(period_bucket, 'YYYY-MM') AS period_label,
    source,
    category,
    COUNT(*)::INT AS event_count
FROM analytics_events
WHERE ($5::TEXT IS NULL OR LOWER(COALESCE(category, '')) = LOWER($5::TEXT))
GROUP BY period_bucket, source, category
ORDER BY period_bucket, source, category
`;

const FEEDBACK_TRENDS_SQL = `
WITH normalized_feedback AS (
    SELECT
        date_trunc('month', f.created_at) AS period_bucket,
        f.rating,
        CASE
            WHEN LOWER(COALESCE(f.category, '')) IN ('positive', 'tích cực', 'tich cuc') THEN 'positive'
            WHEN LOWER(COALESCE(f.category, '')) IN ('negative', 'tiêu cực', 'tieu cuc') THEN 'negative'
            WHEN LOWER(COALESCE(f.category, '')) IN ('neutral', 'trung lập', 'trung lap') THEN 'neutral'
            WHEN f.rating >= 4 THEN 'positive'
            WHEN f.rating <= 2 THEN 'negative'
            ELSE 'neutral'
        END AS sentiment
    FROM Feedbacks f
    WHERE f.created_at >= $1::TIMESTAMPTZ
      AND f.created_at < $2::TIMESTAMPTZ
      AND ($3::UUID IS NULL OR f.counselor_id = $3::UUID)
      AND ($4::TEXT IS NULL OR LOWER(COALESCE(f.category, '')) = LOWER($4::TEXT))
)
SELECT
    TO_CHAR(period_bucket, 'YYYY-MM') AS period_label,
    sentiment,
    COUNT(*)::INT AS feedback_count,
    ROUND(AVG(rating)::NUMERIC, 2) AS average_rating
FROM normalized_feedback
GROUP BY period_bucket, sentiment
ORDER BY period_bucket, sentiment
`;

export class PgAnalyticsRepository implements AnalyticsRepositoryPort {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async getFilterOptions(): Promise<AnalyticsFilterOptions> {
    const [counselors, tests, categories] = await Promise.all([
      this.pool.query(`
        SELECT counselor_id AS id, CONCAT_WS(' ', first_name, last_name) AS name
        FROM Counselors
        WHERE UPPER(status) = 'ACTIVE'
        ORDER BY last_name, first_name
      `),
      this.pool.query(`
        SELECT test_id AS id, test_name AS name, test_type AS type
        FROM Tests
        WHERE UPPER(status) = 'ACTIVE'
        ORDER BY test_name
      `),
      this.pool.query(`
        SELECT DISTINCT category
        FROM (
          SELECT NULLIF(BTRIM(assessment_category), '') AS category FROM Assessments
          UNION
          SELECT NULLIF(BTRIM(category), '') FROM Results
          UNION
          SELECT NULLIF(BTRIM(category), '') FROM Feedbacks
        ) categories
        WHERE category IS NOT NULL
        ORDER BY category
      `),
    ]);

    return {
      counselors: counselors.rows as AnalyticsFilterOptions['counselors'],
      tests: tests.rows as AnalyticsFilterOptions['tests'],
      categories: categories.rows.map((row) => String(row.category)),
    };
  }

  async getStudentTrendRows(filters: AnalyticsFilters): Promise<StudentTrendRow[]> {
    const result = await this.pool.query(STUDENT_TRENDS_SQL, [
      filters.range.start,
      filters.range.end,
      filters.counselorId,
      filters.testId,
      filters.category,
    ]);
    return result.rows as StudentTrendRow[];
  }

  async getFeedbackTrendRows(filters: AnalyticsFilters): Promise<FeedbackTrendRow[]> {
    const result = await this.pool.query(FEEDBACK_TRENDS_SQL, [
      filters.range.start,
      filters.range.end,
      filters.counselorId,
      filters.category,
    ]);
    return result.rows as FeedbackTrendRow[];
  }

  async recordAudit(
    actorRole: string,
    action: string,
    entityType: string,
    entityId: string | null = null,
  ): Promise<void> {
    await this.pool.query(`
      INSERT INTO Audit_Logs (actor_role, action, entity_type, entity_id, value)
      VALUES ($1, $2, $3, $4::UUID, $5)
    `, [actorRole, action, entityType, entityId, '{"detail":"redacted"}']);
  }

  async listAuditLogs(limit: number): Promise<AuditLogRow[]> {
    const result = await this.pool.query(`
      SELECT audit_log_id, actor_role, action, entity_type, entity_id, created_at
      FROM Audit_Logs
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
    return result.rows as AuditLogRow[];
  }
}
