import type { CounselorRepositoryPort } from '../repositories/counselorRepository.js';
import type {
  CounselorAnalyticsRow,
  CounselorDto,
  CreateCounselorInput,
  KpiItem,
  ReportingPeriod,
  UpdateCounselorInput,
} from '../types/counselor.js';
import type { GoogleSheetsCounselorInput } from '../types/googleSheets.js';
import type { CounselorServicePort } from '../types/services.js';
import { AppError } from '../utils/appError.js';
import { toDateOnly } from '../utils/dateOnly.js';
import {
  calculateKpiScore,
  evaluateKpiSet,
  evaluateKpiValue,
  KPI_DEFINITIONS,
  MINIMUM_FEEDBACK_SAMPLE_SIZE,
} from '../utils/kpiPolicy.js';
import { getPeriodRange, safePercentage } from '../utils/period.js';

const toNumber = (value: number | string | null): number | null => {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toCount = (value: number | string): number => toNumber(value) ?? 0;

const formatActual = (actual: number | null, unit: string): string => {
  if (actual === null) return 'Unavailable';
  if (unit === '%') return `${actual.toFixed(2)}%`;
  if (unit === '/ 5.0') return `${actual.toFixed(2)} / 5.0`;
  return `${actual} ${unit}`;
};

const createKpi = (
  definition: (typeof KPI_DEFINITIONS)[number],
  actualNumeric: number | null,
  notes: string,
  evidence?: KpiItem['evidence'],
): KpiItem => ({
  ...definition,
  actualNumeric,
  actualValue: formatActual(actualNumeric, definition.unit),
  score: calculateKpiScore(definition, actualNumeric, evidence),
  isPassed: evaluateKpiValue(definition, actualNumeric, evidence),
  notes,
  evidence,
});

export const mapAnalyticsRow = (row: CounselorAnalyticsRow): CounselorDto => {
  const assignedStudents = toCount(row.assigned_students);
  const weightedCaseloadPoints = toNumber(row.weighted_caseload_points) ?? assignedStudents;
  const fteRatio = toNumber(row.fte_ratio) ?? 1;
  const normalizedCaseload = fteRatio > 0
    ? Math.round((weightedCaseloadPoints / fteRatio) * 100) / 100
    : null;
  const studentServiceHours = toNumber(row.student_service_hours) ?? 0;
  const registeredWorkdays = toCount(row.registered_workdays);
  const registeredHours = toNumber(row.registered_hours) ?? 0;
  const maxDailyHours = toNumber(row.max_daily_hours) ?? 0;
  const overLimitDays = toCount(row.over_limit_days);
  const weeksWithoutRest = toCount(row.weeks_without_rest);
  const completedSessions = toCount(row.completed_sessions);
  const totalSessions = toCount(row.total_sessions);
  const completedBookings = toCount(row.completed_bookings);
  const pendingBookings = toCount(row.pending_bookings);
  const cancelledBookings = toCount(row.cancelled_bookings);
  const totalBookings = toCount(row.total_bookings);
  const completedTests = toCount(row.completed_tests);
  const assignedTests = toCount(row.total_assigned_tests);
  const feedbackCount = toCount(row.feedback_count);
  const satisfactionScore = toNumber(row.satisfaction_score);
  const studentServiceTime = safePercentage(studentServiceHours, registeredHours);
  const outcomeExperienceScore = feedbackCount >= MINIMUM_FEEDBACK_SAMPLE_SIZE && satisfactionScore !== null
    ? Math.round(satisfactionScore * 20 * 100) / 100
    : null;

  const actuals = new Map<string, number | null>([
    ['weighted-caseload-capacity', normalizedCaseload],
    ['student-service-time', studentServiceTime],
    ['eligible-session-completion', safePercentage(completedSessions, totalSessions)],
    ['assessment-follow-through', safePercentage(completedTests, assignedTests)],
    ['student-outcome-experience', outcomeExperienceScore],
  ]);

  const kpis = KPI_DEFINITIONS.map((definition) => {
    const actual = actuals.get(definition.id) ?? null;

    switch (definition.id) {
      case 'weighted-caseload-capacity':
        return createKpi(
          definition,
          actual,
          'Active cases are normalized by FTE. The current schema defaults each case to weight 1 and each counselor to 1.0 FTE.',
          { sampleSize: assignedStudents, weightedCaseloadPoints, fteRatio },
        );
      case 'student-service-time':
        return createKpi(
          definition,
          actual,
          `${studentServiceHours.toFixed(2)} completed student-session hours of ${registeredHours.toFixed(2)} registered service hours. Indirect service requires structured time logs and is not yet included.`,
          {
            numerator: studentServiceHours,
            denominator: registeredHours,
            studentServiceHours,
            registeredHours,
          },
        );
      case 'eligible-session-completion':
        return createKpi(
          definition,
          actual,
          `${completedSessions} completed of ${totalSessions} eligible sessions due in the reporting period. Student cancellations, reschedules and future sessions are excluded.`,
          { numerator: completedSessions, denominator: totalSessions },
        );
      case 'assessment-follow-through':
        return createKpi(
          definition,
          actual,
          `${completedTests} completed of ${assignedTests} eligible assigned assessments; declined, withdrawn, not-required and cancelled assignments are excluded.`,
          { numerator: completedTests, denominator: assignedTests },
        );
      default:
        return createKpi(
          definition,
          actual,
          `Perceived outcome score from ${feedbackCount} anonymous responses. A minimum of ${MINIMUM_FEEDBACK_SAMPLE_SIZE} responses is required; structured clinical outcome data is not yet available in the current schema.`,
          {
            sampleSize: feedbackCount,
            minimumSampleSize: MINIMUM_FEEDBACK_SAMPLE_SIZE,
            averageRating: satisfactionScore ?? undefined,
          },
        );
    }
  });
  const evaluation = evaluateKpiSet(kpis);
  const dateOfBirth = toDateOnly(row.date_of_birth);
  const pendingTests = Math.max(0, assignedTests - completedTests);
  const hrCompliance = {
    status: registeredWorkdays === 0
      ? 'No Data' as const
      : overLimitDays === 0 && weeksWithoutRest === 0
        ? 'Compliant' as const
        : 'Needs Review' as const,
    registeredWorkdays,
    registeredHours,
    maxDailyHours,
    overLimitDays,
    weeksWithoutRest,
    note: 'HR attendance is reported separately from professional KPI scoring. Expected contracted hours, holidays and approved leave are not available in the current schema.',
  };

  return {
    id: row.counselor_id,
    firstName: row.first_name,
    lastName: row.last_name,
    name: `${row.first_name} ${row.last_name}`.trim(),
    gender: row.gender,
    phoneNumber: row.phone_number,
    email: row.email,
    dateOfBirth,
    role: row.role,
    specialization: row.specialization,
    status: row.status,
    fteRatio,
    title: row.role ?? 'Counselor',
    department: row.specialization ?? 'Counseling Services',
    kpis,
    ...evaluation,
    hrCompliance,
    relationshipSummary: {
      assignedStudents,
      completedBookings,
      pendingBookings,
      cancelledBookings,
      completedTests,
      pendingTests,
      avgResponseHours: 0,
      satisfactionScore: satisfactionScore ?? 0,
    },
    periodMetrics: {
      assignedStudents,
      completedBookings,
      pendingBookings,
      cancelledBookings,
      completedSessions,
      totalSessions,
      completedTests,
      pendingTests,
      assignedTests,
      satisfactionScore: satisfactionScore ?? 0,
      feedbackCount,
      overallScore: evaluation.overallScore,
      hrCompliance,
      kpis,
    },
  };
};

export class CounselorService implements CounselorServicePort {
  constructor(private readonly repository: CounselorRepositoryPort) {}

  async list(period: ReportingPeriod): Promise<CounselorDto[]> {
    const rows = await this.repository.listAnalytics(getPeriodRange(period));
    return rows.map(mapAnalyticsRow);
  }

  async getById(id: string, period: ReportingPeriod): Promise<CounselorDto> {
    const row = await this.repository.getAnalyticsById(id, getPeriodRange(period));
    if (!row) throw new AppError(404, 'Counselor was not found.', 'COUNSELOR_NOT_FOUND');
    return mapAnalyticsRow(row);
  }

  async create(input: CreateCounselorInput, period: ReportingPeriod): Promise<CounselorDto> {
    const profile = await this.repository.create(input);
    return this.getById(profile.counselor_id, period);
  }

  async update(
    id: string,
    input: UpdateCounselorInput,
    period: ReportingPeriod,
  ): Promise<CounselorDto> {
    const profile = await this.repository.update(id, input);
    if (!profile) throw new AppError(404, 'Counselor was not found.', 'COUNSELOR_NOT_FOUND');
    return this.getById(id, period);
  }

  async deactivate(id: string): Promise<void> {
    const updated = await this.repository.deactivate(id);
    if (!updated) throw new AppError(404, 'Counselor was not found.', 'COUNSELOR_NOT_FOUND');
  }

  async syncFromGoogleSheets(
    input: GoogleSheetsCounselorInput,
  ): Promise<{ counselor: CounselorDto; created: boolean }> {
    const result = await this.repository.syncFromGoogleSheets(input);
    return {
      counselor: await this.getById(result.profile.counselor_id, 'this_month'),
      created: result.created,
    };
  }
}
