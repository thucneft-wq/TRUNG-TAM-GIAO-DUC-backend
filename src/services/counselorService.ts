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
import { evaluateKpiSet, evaluateValue, KPI_DEFINITIONS } from '../utils/kpiPolicy.js';
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
  isPassed: evaluateValue(
    actualNumeric,
    definition.targetNumeric,
    definition.comparisonType,
  ),
  notes,
  evidence,
});

export const mapAnalyticsRow = (row: CounselorAnalyticsRow): CounselorDto => {
  const assignedStudents = toCount(row.assigned_students);
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

  const actuals = new Map<string, number | null>([
    ['caseload-compliance', assignedStudents],
    ['session-completion-rate', safePercentage(completedSessions, totalSessions)],
    ['booking-cancellation-rate', safePercentage(cancelledBookings, totalBookings)],
    ['test-completion-rate', safePercentage(completedTests, assignedTests)],
    ['student-satisfaction', satisfactionScore],
  ]);

  const kpis = KPI_DEFINITIONS.map((definition) => {
    const actual = actuals.get(definition.id) ?? null;

    switch (definition.id) {
      case 'caseload-compliance':
        return createKpi(
          definition,
          actual,
          'Distinct students with active assignments that have not ended.',
          { sampleSize: assignedStudents },
        );
      case 'session-completion-rate':
        return createKpi(
          definition,
          actual,
          `${completedSessions} completed of ${totalSessions} sessions.`,
          { numerator: completedSessions, denominator: totalSessions },
        );
      case 'booking-cancellation-rate':
        return createKpi(
          definition,
          actual,
          `${cancelledBookings} cancelled of ${totalBookings} bookings.`,
          { numerator: cancelledBookings, denominator: totalBookings },
        );
      case 'test-completion-rate':
        return createKpi(
          definition,
          actual,
          `${completedTests} completed of ${assignedTests} assigned tests.`,
          { numerator: completedTests, denominator: assignedTests },
        );
      default:
        return createKpi(
          definition,
          actual,
          `Anonymous average from ${feedbackCount} feedback ratings.`,
          { sampleSize: feedbackCount },
        );
    }
  });
  const evaluation = evaluateKpiSet(kpis);
  const dateOfBirth = row.date_of_birth
    ? new Date(row.date_of_birth).toISOString().slice(0, 10)
    : null;
  const pendingTests = Math.max(0, assignedTests - completedTests);

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
    title: row.role ?? 'Counselor',
    department: row.specialization ?? 'Counseling Services',
    kpis,
    ...evaluation,
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
