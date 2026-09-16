import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import test from 'node:test';
import type { Pool } from 'pg';
import {
  COUNSELOR_ANALYTICS_SQL,
  DEACTIVATE_COUNSELOR_SQL,
  PgCounselorRepository,
  UPDATE_COUNSELOR_SQL,
  type CounselorRepositoryPort,
} from '../src/repositories/counselorRepository.js';
import type { AnalyticsRepositoryPort } from '../src/repositories/analyticsRepository.js';
import type { StudentRepositoryPort } from '../src/repositories/studentRepository.js';
import type { FeedbackRepositoryPort } from '../src/repositories/feedbackRepository.js';
import { AnalyticsService } from '../src/services/analyticsService.js';
import { AuthService } from '../src/services/authService.js';
import { CounselorService } from '../src/services/counselorService.js';
import { StudentService } from '../src/services/studentService.js';
import { FeedbackService } from '../src/services/feedbackService.js';
import type { AnalyticsFilters } from '../src/types/analytics.js';
import type { StudentRow } from '../src/types/student.js';
import type {
  CounselorAnalyticsRow,
  CounselorProfileRow,
  KpiItem,
} from '../src/types/counselor.js';
import {
  calculateKpiScore,
  evaluateKpiSet,
  evaluateKpiValue,
  KPI_DEFINITIONS,
} from '../src/utils/kpiPolicy.js';
import { safePercentage } from '../src/utils/period.js';
import { AppError } from '../src/utils/appError.js';

const createKpis = (failedId?: string, nullId?: string): KpiItem[] =>
  KPI_DEFINITIONS.map((definition) => {
    const passingValue = definition.comparisonType === 'lte'
      ? definition.targetNumeric
      : definition.targetNumeric;
    const failingValue = definition.comparisonType === 'lte'
      ? definition.targetNumeric + 1
      : definition.targetNumeric - 1;
    const actualNumeric = definition.id === nullId
      ? null
      : definition.id === failedId ? failingValue : passingValue;

    const evidence: KpiItem['evidence'] = definition.id === 'weighted-caseload-capacity'
      ? { sampleSize: actualNumeric ?? 0, weightedCaseloadPoints: actualNumeric ?? 0, fteRatio: 1 }
      : definition.id === 'student-service-time'
        ? { numerator: 8, denominator: 10, studentServiceHours: 8, registeredHours: 10 }
        : definition.id === 'eligible-session-completion'
          ? { numerator: 4, denominator: 5 }
          : definition.id === 'assessment-follow-through'
            ? { numerator: 3, denominator: 3 }
            : { sampleSize: 5, minimumSampleSize: 5 };

    return {
      ...definition,
      actualNumeric,
      actualValue: String(actualNumeric),
      score: calculateKpiScore(definition, actualNumeric, evidence),
      isPassed: evaluateKpiValue(definition, actualNumeric, evidence),
      notes: 'Unit test fixture',
      evidence,
    };
  });

test('four on-target performance KPIs with a safe caseload evaluate to Pass', () => {
  const result = evaluateKpiSet(createKpis());
  assert.equal(result.passedKpis, 4);
  assert.equal(result.overallStatus, 'Pass');
});

test('three of four performance KPIs can pass with a minor miss', () => {
  const result = evaluateKpiSet(createKpis('student-outcome-experience'));
  assert.equal(result.passedKpis, 3);
  assert.equal(result.overallStatus, 'Pass');
});

test('one unavailable performance KPI can still pass with the other three met', () => {
  const result = evaluateKpiSet(createKpis(undefined, 'eligible-session-completion'));
  assert.equal(result.passedKpis, 3);
  assert.equal(result.overallStatus, 'Pass');
});

test('two unavailable criteria return Insufficient Data instead of a performance failure', () => {
  const kpis = createKpis(undefined, 'eligible-session-completion').map((kpi) =>
    kpi.id === 'assessment-follow-through'
      ? { ...kpi, actualNumeric: null, score: 0, isPassed: false }
      : kpi,
  );
  const result = evaluateKpiSet(kpis);
  assert.equal(result.evaluableKpis, 2);
  assert.equal(result.insufficientDataKpis, 2);
  assert.equal(result.overallStatus, 'Insufficient Data');
});

test('zero denominator returns NULL instead of dividing by zero', () => {
  assert.equal(safePercentage(0, 0), null);
  assert.equal(safePercentage(4, 5), 80);
});

test('weighted caseload is a safety guardrail and zero cases are insufficient data', () => {
  const definition = KPI_DEFINITIONS.find((item) => item.id === 'weighted-caseload-capacity')!;
  assert.equal(evaluateKpiValue(definition, 0), false);
  assert.equal(evaluateKpiValue(definition, 8), true);
  assert.equal(evaluateKpiValue(definition, 20), true);
  assert.equal(evaluateKpiValue(definition, 21), false);
  const noCases = createKpis().map((kpi) => kpi.id === definition.id
    ? { ...kpi, actualNumeric: 0, score: 0, isPassed: false }
    : kpi);
  assert.equal(evaluateKpiSet(noCases).overallStatus, 'Insufficient Data');
  const overloaded = evaluateKpiSet(createKpis('weighted-caseload-capacity'));
  assert.equal(overloaded.overallStatus, 'Not Pass');
});

test('student outcome and experience requires a minimum anonymous sample', () => {
  const definition = KPI_DEFINITIONS.find((item) => item.id === 'student-outcome-experience')!;
  assert.equal(evaluateKpiValue(definition, 90, { sampleSize: 4, minimumSampleSize: 5 }), false);
  assert.equal(evaluateKpiValue(definition, 90, { sampleSize: 5, minimumSampleSize: 5 }), true);
});

test('Admin KPI query follows the official formulas', () => {
  assert.match(
    COUNSELOR_ANALYTICS_SQL,
    /UPPER\(c\.status\) IN \('ACTIVE', 'ON_LEAVE'\)/,
  );
  assert.match(COUNSELOR_ANALYTICS_SQL, /car\.ended_at IS NULL/);
  assert.match(COUNSELOR_ANALYTICS_SQL, /UPPER\(s\.status\) = 'COMPLETED'/);
  assert.doesNotMatch(COUNSELOR_ANALYTICS_SQL, /s\.ended_at IS NOT NULL/);
  assert.match(COUNSELOR_ANALYTICS_SQL, /b\.cancelled_at IS NOT NULL/);
  assert.match(COUNSELOR_ANALYTICS_SQL, /FROM Availability_Slots a/);
  assert.match(COUNSELOR_ANALYTICS_SQL, /a\.start_time >= \$3::TIMESTAMPTZ/);
  assert.match(COUNSELOR_ANALYTICS_SQL, /registered_hours > 8/);
  assert.match(COUNSELOR_ANALYTICS_SQL, /registered_workdays > 6/);
  assert.match(COUNSELOR_ANALYTICS_SQL, /INTERVAL '1 hour'/);
  assert.match(COUNSELOR_ANALYTICS_SQL, /max_session_hours/);
  assert.match(COUNSELOR_ANALYTICS_SQL, /over_limit_sessions/);
  assert.match(COUNSELOR_ANALYTICS_SQL, /student_service_hours/);
  assert.match(COUNSELOR_ANALYTICS_SQL, /NO_SHOW_STUDENT/);
  assert.match(COUNSELOR_ANALYTICS_SQL, /'DECLINED', 'WITHDRAWN', 'NOT_REQUIRED'/);
  assert.match(
    COUNSELOR_ANALYTICS_SQL,
    /r\.result_id IS NOT NULL OR UPPER\(tat\.status\) = 'COMPLETED'/,
  );
  assert.doesNotMatch(COUNSELOR_ANALYTICS_SQL, /tat\.submitted_at IS NOT NULL/);
  assert.match(COUNSELOR_ANALYTICS_SQL, /ROUND\(AVG\(f\.rating\)::NUMERIC, 2\)/);
  assert.doesNotMatch(COUNSELOR_ANALYTICS_SQL, /booking-cancellation-rate/);
});

test('Only the configured Admin account can authenticate to the Web portal', async () => {
  const passwordHash = await bcrypt.hash('Admin@123', 4);
  const service = new AuthService([{
    id: 'admin',
    name: 'Admin Supervisor',
    email: 'admin@example.invalid',
    passwordHash,
    role: 'admin',
  }], 'test-only-jwt-secret-with-at-least-32-characters');

  const result = await service.login('ADMIN@example.invalid', 'Admin@123');
  assert.equal(result.user.role, 'admin');
  assert.equal(result.user.id, 'admin');

  await assert.rejects(
    () => service.login('counselor@example.invalid', 'Admin@123'),
    (error: unknown) => error instanceof AppError
      && error.status === 401
      && error.code === 'INVALID_CREDENTIALS',
  );
});

const analyticsFilters: AnalyticsFilters = {
  period: 'this_month',
  range: {
    start: new Date('2026-08-01T00:00:00.000Z'),
    end: new Date('2026-09-01T00:00:00.000Z'),
  },
  counselorId: null,
  testId: null,
  category: null,
};

const createAnalyticsRepository = (): AnalyticsRepositoryPort => ({
  getFilterOptions: async () => ({ counselors: [], tests: [], categories: [] }),
  getStudentTrendRows: async () => [{
    period_label: '2026-08',
    source: 'assessment',
    category: 'Cần theo dõi',
    event_count: 3,
  }],
  getFeedbackTrendRows: async () => [{
    period_label: '2026-08',
    sentiment: 'positive',
    feedback_count: 2,
    average_rating: 5,
  }],
  recordAudit: async () => undefined,
  listAuditLogs: async () => [],
});

test('small analytics samples hide detailed values and averages', async () => {
  const service = new AnalyticsService(createAnalyticsRepository(), 5);
  const student = await service.getStudentTrends(analyticsFilters);
  const feedback = await service.getFeedback(analyticsFilters);

  assert.equal(student.suppressed, true);
  assert.equal(student.totalAssessments, 0);
  assert.deepEqual(student.timeline, []);
  assert.equal(feedback.suppressed, true);
  assert.equal(feedback.averageRating, null);
  assert.deepEqual(feedback.distribution, { positive: 0, neutral: 0, negative: 0 });
});

test('overview CSV does not expose small-sample analytics', async () => {
  const service = new AnalyticsService(createAnalyticsRepository(), 5);
  const result = await service.exportCsv(analyticsFilters, 'overview');
  assert.match(result, /Dữ liệu bị ẩn do chưa đủ ngưỡng mẫu/);
  assert.doesNotMatch(result, /Tổng assessment/);
});

const studentRow: StudentRow = {
  student_id: '20000000-0000-4000-8000-000000000001',
  external_student_id: 'HS-01',
  first_name: 'Dev',
  last_name: 'Student',
  gender: null,
  phone_number: '000-100-0001',
  email: null,
  date_of_birth: new Date('2010-01-01T00:00:00+07:00'),
  status: 'ACTIVE',
  school_level: 'THCS',
  school_name: 'Trường THCS Mẫu',
  school_id: null,
  address_id: null,
  assigned_counselor_id: '10000000-0000-4000-8000-000000000001',
  assigned_counselor_name: 'Dev Counselor',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: null,
};

const createStudentRepository = (): StudentRepositoryPort => ({
  list: async () => [studentRow],
  getById: async () => studentRow,
  findBySyncIdentifier: async () => null,
  create: async () => studentRow,
  update: async () => studentRow,
  deactivate: async () => true,
});

test('student service maps only the scoped repository result', async () => {
  const service = new StudentService(createStudentRepository());
  const students = await service.list({
    role: 'counselor',
    counselorId: studentRow.assigned_counselor_id,
  });
  assert.equal(students.length, 1);
  assert.equal(students[0].externalId, 'HS-01');
  assert.equal(students[0].name, 'Dev Student');
  assert.equal(students[0].schoolLevel, 'THCS');
  assert.equal(students[0].schoolName, 'Trường THCS Mẫu');
  assert.equal(students[0].dateOfBirth, '2010-01-01');
  assert.equal(students[0].assignedCounselorId, studentRow.assigned_counselor_id);
});

test('unlinked counselor cannot access Student service', async () => {
  const service = new StudentService(createStudentRepository());
  await assert.rejects(
    service.list({ role: 'counselor', counselorId: null }),
    (error: unknown) => (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'COUNSELOR_NOT_LINKED'
    ),
  );
});

test('Google Sheets inactive status soft-deletes an existing student', async () => {
  let deactivatedId = '';
  let updateCalled = false;
  const repository = createStudentRepository();
  repository.findBySyncIdentifier = async () => studentRow;
  repository.deactivate = async (id) => {
    deactivatedId = id;
    return true;
  };
  repository.getById = async () => ({ ...studentRow, status: 'INACTIVE' });
  repository.update = async () => {
    updateCalled = true;
    return studentRow;
  };

  const service = new StudentService(repository);
  const result = await service.syncFromGoogleSheets({
    firstName: studentRow.first_name,
    lastName: studentRow.last_name,
    phoneNumber: studentRow.phone_number,
    email: studentRow.email,
    status: 'INACTIVE',
    schoolLevel: studentRow.school_level,
    schoolName: studentRow.school_name,
  });

  assert.equal(result.created, false);
  assert.equal(result.student.status, 'INACTIVE');
  assert.equal(deactivatedId, studentRow.student_id);
  assert.equal(updateCalled, false);
});

const analyticsRow: CounselorAnalyticsRow = {
  counselor_id: '10000000-0000-4000-8000-000000000001',
  external_counselor_id: 'TTV-01',
  first_name: 'Dev',
  last_name: 'Counselor',
  gender: null,
  phone_number: null,
  email: 'dev@example.invalid',
  date_of_birth: null,
  role: 'Counselor',
  specialization: 'Development',
  status: 'ACTIVE',
  assigned_students: 10,
  weighted_caseload_points: 10,
  fte_ratio: 1,
  student_service_hours: 166.4,
  registered_workdays: 26,
  registered_hours: 208,
  max_daily_hours: 1,
  over_limit_days: 0,
  weeks_without_rest: 0,
  completed_sessions: 4,
  total_sessions: 5,
  completed_bookings: 4,
  pending_bookings: 1,
  cancelled_bookings: 0,
  total_bookings: 5,
  completed_tests: 4,
  total_assigned_tests: 5,
  satisfaction_score: 4.5,
  feedback_count: 4,
};

const profileRow: CounselorProfileRow = analyticsRow;

const createMockRepository = (): CounselorRepositoryPort => ({
  listAnalytics: async () => [analyticsRow],
  getAnalyticsById: async () => analyticsRow,
  create: async () => profileRow,
  update: async () => profileRow,
  deactivate: async () => true,
  syncFromGoogleSheets: async () => ({ profile: profileRow, created: true }),
  getDashboardCounts: async () => ({
    total_students: 1,
    active_counselors: 1,
    total_tests: 2,
    total_test_attempts: 3,
    total_bookings: 5,
    completed_bookings: 4,
    pending_bookings: 1,
    cancelled_bookings: 0,
  }),
  getDashboardTrends: async () => [],
});

test('counselor service reads and maps anonymous analytics', async () => {
  const service = new CounselorService(createMockRepository());
  const counselor = await service.getById(analyticsRow.counselor_id, 'this_month');
  assert.equal(counselor.externalId, 'TTV-01');
  assert.equal(counselor.name, 'Dev Counselor');
  assert.equal(counselor.kpis.length, 5);
  assert.equal(counselor.overallStatus, 'Pass');
  assert.equal(counselor.overallScore, 76.47);
  assert.equal(counselor.evaluableKpis, 3);
  assert.equal(counselor.insufficientDataKpis, 1);
  assert.equal(counselor.hrCompliance.status, 'Compliant');
  assert.equal('students' in counselor, false);
});

test('SQL repository keeps create values parameterized', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const fakePool = {
    query: async (sql: string, values: unknown[]) => {
      calls.push({ sql, values });
      return { rows: [profileRow], rowCount: 1 };
    },
  } as unknown as Pick<Pool, 'query'>;
  const repository = new PgCounselorRepository(fakePool);
  const maliciousName = "Robert'); UPDATE Counselors SET status='INACTIVE'; --";

  await repository.create({
    firstName: maliciousName,
    lastName: 'Fixture',
    status: 'ACTIVE',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].sql.includes(maliciousName), false);
  assert.equal(calls[0].values.includes(maliciousName), true);
  assert.match(calls[0].sql, /VALUES \(\$1, \$2, \$3/);
});

test('update and deactivate SQL use placeholders and soft-delete status', () => {
  assert.match(UPDATE_COUNSELOR_SQL, /WHERE counselor_id = \$1::UUID/);
  assert.doesNotMatch(UPDATE_COUNSELOR_SQL, /\$\{[^}]+\}/);
  assert.match(DEACTIVATE_COUNSELOR_SQL, /SET status = 'INACTIVE'/);
  assert.match(DEACTIVATE_COUNSELOR_SQL, /WHERE counselor_id = \$1::UUID/);
  assert.doesNotMatch(DEACTIVATE_COUNSELOR_SQL, /DELETE FROM/i);
});

test('feedback synchronization derives sentiment and keeps Sheet retries idempotent', async () => {
  let receivedCategory: string | null | undefined;
  const repository: FeedbackRepositoryPort = {
    syncFromGoogleSheets: async (input) => {
      receivedCategory = input.category;
      return {
        feedbackId: '40000000-0000-4000-8000-000000000001',
        sessionId: '50000000-0000-4000-8000-000000000001',
        bookingId: input.bookingId ?? '60000000-0000-4000-8000-000000000001',
        studentId: '20000000-0000-4000-8000-000000000001',
        counselorId: '10000000-0000-4000-8000-000000000001',
        rating: input.rating,
        category: input.category ?? null,
        createdAt: '2026-09-16T00:00:00.000Z',
        created: false,
      };
    },
  };
  const result = await new FeedbackService(repository).syncFromGoogleSheets({
    bookingId: '60000000-0000-4000-8000-000000000001',
    rating: 5,
    comment: '  Hữu ích  ',
  });

  assert.equal(receivedCategory, 'positive');
  assert.equal(result.created, false);
});

test('feedback synchronization rejects an unknown counseling session', async () => {
  const repository: FeedbackRepositoryPort = {
    syncFromGoogleSheets: async () => null,
  };

  await assert.rejects(
    () => new FeedbackService(repository).syncFromGoogleSheets({
      bookingId: '60000000-0000-4000-8000-000000000001',
      rating: 3,
    }),
    (error: unknown) => error instanceof AppError && error.code === 'FEEDBACK_SESSION_NOT_FOUND',
  );
});
