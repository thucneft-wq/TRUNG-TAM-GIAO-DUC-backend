export type ReportingPeriod = 'this_month' | 'last_month' | 'all_time';
export type CounselorStatus = 'ACTIVE' | 'INACTIVE' | 'ON_LEAVE';
export type KpiComparison = 'gte' | 'lte';
export type OverallStatus = 'Pass' | 'Not Pass' | 'Insufficient Data';

export interface PeriodRange {
  start: Date;
  end: Date;
}

export interface CreateCounselorInput {
  firstName: string;
  lastName: string;
  gender?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  dateOfBirth?: string | null;
  role?: string | null;
  specialization?: string | null;
  status: CounselorStatus;
  fteRatio?: number;
}

export type UpdateCounselorInput = Partial<CreateCounselorInput>;

export interface CounselorProfileRow {
  counselor_id: string;
  external_counselor_id: string | null;
  first_name: string;
  last_name: string;
  gender: string | null;
  phone_number: string | null;
  email: string | null;
  date_of_birth: string | Date | null;
  role: string | null;
  specialization: string | null;
  status: CounselorStatus;
  fte_ratio: number | string;
  created_at?: Date;
  updated_at?: Date | null;
}

export interface CounselorAnalyticsRow extends CounselorProfileRow {
  assigned_students: number | string;
  weighted_caseload_points: number | string;
  student_service_hours: number | string;
  registered_workdays: number | string;
  registered_hours: number | string;
  max_daily_hours: number | string;
  over_limit_days: number | string;
  weeks_without_rest: number | string;
  completed_sessions: number | string;
  total_sessions: number | string;
  completed_bookings: number | string;
  pending_bookings: number | string;
  cancelled_bookings: number | string;
  total_bookings: number | string;
  completed_tests: number | string;
  total_assigned_tests: number | string;
  satisfaction_score: number | string | null;
  feedback_count: number | string;
}

export interface KpiItem {
  id: string;
  name: string;
  category: string;
  actualNumeric: number | null;
  actualValue: string;
  targetNumeric: number;
  targetValue: string;
  comparisonType: KpiComparison;
  unit: string;
  weight: number;
  score: number;
  hardGuardrail?: boolean;
  isPassed: boolean;
  notes: string;
  evidence?: {
    numerator?: number;
    denominator?: number;
    sampleSize?: number;
    registeredHours?: number;
    maxDailyHours?: number;
    overLimitDays?: number;
    weeksWithoutRest?: number;
    weightedCaseloadPoints?: number;
    fteRatio?: number;
    studentServiceHours?: number;
    minimumSampleSize?: number;
    averageRating?: number;
  };
}

export interface HrComplianceSummary {
  status: 'Compliant' | 'Needs Review' | 'No Data';
  registeredWorkdays: number;
  registeredHours: number;
  maxDailyHours: number;
  overLimitDays: number;
  weeksWithoutRest: number;
  note: string;
}

export interface CounselorDto {
  id: string;
  externalId: string | null;
  firstName: string;
  lastName: string;
  name: string;
  gender: string | null;
  phoneNumber: string | null;
  email: string | null;
  dateOfBirth: string | null;
  role: string | null;
  specialization: string | null;
  status: CounselorStatus;
  fteRatio: number;
  title: string;
  department: string;
  kpis: KpiItem[];
  passedKpis: number;
  evaluableKpis: number;
  failedKpis: number;
  insufficientDataKpis: number;
  totalKpis: 5;
  overallScore: number;
  overallStatus: OverallStatus;
  hrCompliance: HrComplianceSummary;
  relationshipSummary: {
    assignedStudents: number;
    completedBookings: number;
    pendingBookings: number;
    cancelledBookings: number;
    completedTests: number;
    pendingTests: number;
    avgResponseHours: number;
    satisfactionScore: number;
  };
  periodMetrics: {
    assignedStudents: number;
    completedBookings: number;
    pendingBookings: number;
    cancelledBookings: number;
    completedSessions: number;
    totalSessions: number;
    completedTests: number;
    pendingTests: number;
    assignedTests: number;
    satisfactionScore: number;
    feedbackCount: number;
    overallScore: number;
    hrCompliance: HrComplianceSummary;
    kpis: KpiItem[];
  };
}

export interface DashboardCountsRow {
  total_students: number | string;
  active_counselors: number | string;
  total_tests: number | string;
  total_test_attempts: number | string;
  total_bookings: number | string;
  completed_bookings: number | string;
  pending_bookings: number | string;
  cancelled_bookings: number | string;
}

export interface DashboardTrendRow {
  period_label: string;
  completed_bookings: number | string;
  pending_bookings: number | string;
  cancelled_bookings: number | string;
}

export interface CounselorReconcileResult {
  deactivatedCounselors: number;
  closedAssignments: number;
}
