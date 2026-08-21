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
import { AnalyticsService } from '../src/services/analyticsService.js';
import { AuthService } from '../src/services/authService.js';
import { CounselorService } from '../src/services/counselorService.js';
import { StudentService } from '../src/services/studentService.js';
import type { AnalyticsFilters } from '../src/types/analytics.js';
import type { StudentRow } from '../src/types/student.js';
import type {
  CounselorAnalyticsRow,
  CounselorProfileRow,
  KpiItem,
} from '../src/types/counselor.js';
import { evaluateKpiSet, evaluateValue, KPI_DEFINITIONS } from '../src/utils/kpiPolicy.js';
import { safePercentage } from '../src/utils/period.js';

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

    return {
      ...definition,
      actualNumeric,
      actualValue: String(actualNumeric),
      isPassed: evaluateValue(actualNumeric, definition.targetNumeric, definition.comparisonType),
      notes: 'Unit test fixture',
    };
  });

test('5/5 KPI values evaluate to Pass', () => {
  const result = evaluateKpiSet(createKpis());
  assert.equal(result.passedKpis, 5);
  assert.equal(result.overallStatus, 'Pass');
});

test('4/5 KPI values evaluate to Not Pass', () => {
  const result = evaluateKpiSet(createKpis('student-satisfaction'));
  assert.equal(result.passedKpis, 4);
  assert.equal(result.overallStatus, 'Not Pass');
});

test('a NULL KPI value evaluates to Not Pass', () => {
  const result = evaluateKpiSet(createKpis(undefined, 'session-completion-rate'));
  assert.equal(result.overallStatus, 'Not Pass');
});

test('zero denominator returns NULL instead of dividing by zero', () => {
  assert.equal(safePercentage(0, 0), null);
  assert.equal(safePercentage(4, 5), 80);
});

test('Admin KPI query follows the official all-time formulas', () => {
  assert.match(COUNSELOR_ANALYTICS_SQL, /car\.ended_at IS NULL/);
  assert.match(COUNSELOR_ANALYTICS_SQL, /UPPER\(s\.status\) = 'COMPLETED'/);
  assert.doesNotMatch(COUNSELOR_ANALYTICS_SQL, /s\.ended_at IS NOT NULL/);
  assert.match(COUNSELOR_ANALYTICS_SQL, /b\.cancelled_at IS NOT NULL/);
  assert.match(
    COUNSELOR_ANALYTICS_SQL,
    /r\.result_id IS NOT NULL OR UPPER\(tat\.status\) = 'COMPLETED'/,
  );
  assert.doesNotMatch(COUNSELOR_ANALYTICS_SQL, /tat\.submitted_at IS NOT NULL/);
  assert.match(COUNSELOR_ANALYTICS_SQL, /ROUND\(AVG\(f\.rating\)::NUMERIC, 2\)/);
  assert.doesNotMatch(
    COUNSELOR_ANALYTICS_SQL,
    /(?:b\.start_time|ta\.assigned_at|f\.created_at)\s*(?:>=|<)/,
  );
});

test('Counselor login can use an ACTIVE database-backed account', async () => {
  const passwordHash = await bcrypt.hash('Counselor@123', 4);
  const service = new AuthService([], 'test-only-jwt-secret-with-at-least-32-characters', {
    findCounselorByEmail: async () => ({
      id: '10000000-0000-4000-8000-000000000001',
      name: 'Dev Counselor',
      email: 'counselor@example.invalid',
      passwordHash,
      role: 'counselor',
    }),
  });
  const result = await service.login('COUNSELOR@example.invalid', 'Counselor@123');
  assert.equal(result.user.role, 'counselor');
  assert.equal(result.user.id, '10000000-0000-4000-8000-000000000001');
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
  first_name: 'Dev',
  last_name: 'Student',
  gender: null,
  phone_number: '000-100-0001',
  email: null,
  date_of_birth: null,
  status: 'ACTIVE',
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
  findByContact: async () => null,
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
  assert.equal(students[0].name, 'Dev Student');
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

const analyticsRow: CounselorAnalyticsRow = {
  counselor_id: '10000000-0000-4000-8000-000000000001',
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
  assert.equal(counselor.name, 'Dev Counselor');
  assert.equal(counselor.kpis.length, 5);
  assert.equal(counselor.overallStatus, 'Pass');
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
