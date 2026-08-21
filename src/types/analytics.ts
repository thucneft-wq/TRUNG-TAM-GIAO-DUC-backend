import type { PeriodRange, ReportingPeriod } from './counselor.js';

export type AnalyticsExportType = 'overview' | 'student_trends' | 'feedback';

export interface AnalyticsFilters {
  period: ReportingPeriod;
  range: PeriodRange;
  counselorId: string | null;
  testId: string | null;
  category: string | null;
}

export interface StudentTrendRow {
  period_label: string;
  source: 'assessment' | 'test_result';
  category: string | null;
  event_count: number | string;
}

export interface FeedbackTrendRow {
  period_label: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  feedback_count: number | string;
  average_rating: number | string | null;
}

export interface AnalyticsFilterOptions {
  counselors: Array<{ id: string; name: string }>;
  tests: Array<{ id: string; name: string; type: string | null }>;
  categories: string[];
}

export interface AuditLogRow {
  audit_log_id: string;
  actor_role: string | null;
  action: string | null;
  entity_type: string | null;
  entity_id: string | null;
  created_at: Date | string;
}
