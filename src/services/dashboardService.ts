import type { CounselorRepositoryPort } from '../repositories/counselorRepository.js';
import type { ReportingPeriod } from '../types/counselor.js';
import type { CounselorServicePort, DashboardServicePort } from '../types/services.js';
import { getPeriodRange } from '../utils/period.js';

const countValue = (value: number | string): number =>
  typeof value === 'number' ? value : Number.parseInt(value, 10) || 0;

export class DashboardService implements DashboardServicePort {
  constructor(
    private readonly repository: CounselorRepositoryPort,
    private readonly counselorService: CounselorServicePort,
  ) {}

  async get(period: ReportingPeriod): Promise<Record<string, unknown>> {
    const range = getPeriodRange(period);
    const [counts, trends, counselors] = await Promise.all([
      this.repository.getDashboardCounts(range),
      this.repository.getDashboardTrends(range),
      this.counselorService.list(period),
    ]);
    const activeCounselors = counselors.filter(
      (counselor) => counselor.status === 'ACTIVE',
    );
    const passedCounselors = activeCounselors.filter(
      (counselor) => counselor.overallStatus === 'Pass',
    ).length;

    return {
      period,
      totalStudents: countValue(counts.total_students),
      activeCounselors: countValue(counts.active_counselors),
      totalTests: countValue(counts.total_tests),
      totalTestAttempts: countValue(counts.total_test_attempts),
      totalBookings: countValue(counts.total_bookings),
      passedCounselors,
      notPassedCounselors: activeCounselors.length - passedCounselors,
      bookingStatus: {
        completed: countValue(counts.completed_bookings),
        pending: countValue(counts.pending_bookings),
        cancelled: countValue(counts.cancelled_bookings),
      },
      monthlyTrends: trends.map((trend) => ({
        month: trend.period_label,
        completed: countValue(trend.completed_bookings),
        pending: countValue(trend.pending_bookings),
        cancelled: countValue(trend.cancelled_bookings),
      })),
      lastUpdated: new Date().toISOString(),
    };
  }
}
