import type { AnalyticsRepositoryPort } from '../repositories/analyticsRepository.js';
import type {
  AnalyticsExportType,
  AnalyticsFilterOptions,
  AnalyticsFilters,
  AuditLogRow,
} from '../types/analytics.js';
import type { AnalyticsServicePort } from '../types/services.js';

const toNumber = (value: number | string | null): number =>
  value === null ? 0 : typeof value === 'number' ? value : Number(value) || 0;

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const csv = (rows: unknown[][]): string =>
  `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;

export class AnalyticsService implements AnalyticsServicePort {
  constructor(
    private readonly repository: AnalyticsRepositoryPort,
    private readonly minimumSampleSize = 5,
  ) {}

  getFilterOptions(): Promise<AnalyticsFilterOptions> {
    return this.repository.getFilterOptions();
  }

  async getStudentTrends(filters: AnalyticsFilters): Promise<Record<string, unknown>> {
    const rows = await this.repository.getStudentTrendRows(filters);
    const timeline = new Map<string, { period: string; assessments: number; testResults: number }>();
    const categories = new Map<string, number>();

    for (const row of rows) {
      const point = timeline.get(row.period_label) ?? {
        period: row.period_label,
        assessments: 0,
        testResults: 0,
      };
      const count = toNumber(row.event_count);
      if (row.source === 'assessment') point.assessments += count;
      else point.testResults += count;
      timeline.set(row.period_label, point);
      const category = row.category ?? 'Chưa phân loại';
      categories.set(category, (categories.get(category) ?? 0) + count);
    }

    const points = [...timeline.values()];
    const totalAssessments = points.reduce((sum, item) => sum + item.assessments, 0);
    const totalTestResults = points.reduce((sum, item) => sum + item.testResults, 0);
    const sampleSize = totalAssessments + totalTestResults;
    const suppressed = sampleSize > 0 && sampleSize < this.minimumSampleSize;

    return {
      period: filters.period,
      sampleSize,
      minimumSampleSize: this.minimumSampleSize,
      suppressed,
      totalAssessments: suppressed ? 0 : totalAssessments,
      totalTestResults: suppressed ? 0 : totalTestResults,
      timeline: suppressed ? [] : points,
      categoryDistribution: suppressed
        ? []
        : [...categories].map(([category, count]) => ({ category, count })),
    };
  }

  async getFeedback(filters: AnalyticsFilters): Promise<Record<string, unknown>> {
    const rows = await this.repository.getFeedbackTrendRows(filters);
    const timeline = new Map<string, {
      period: string;
      positive: number;
      neutral: number;
      negative: number;
      ratingTotal: number;
      ratingCount: number;
    }>();
    const totals = { positive: 0, neutral: 0, negative: 0 };

    for (const row of rows) {
      const count = toNumber(row.feedback_count);
      const point = timeline.get(row.period_label) ?? {
        period: row.period_label,
        positive: 0,
        neutral: 0,
        negative: 0,
        ratingTotal: 0,
        ratingCount: 0,
      };
      point[row.sentiment] += count;
      point.ratingTotal += toNumber(row.average_rating) * count;
      point.ratingCount += count;
      timeline.set(row.period_label, point);
      totals[row.sentiment] += count;
    }

    const sampleSize = totals.positive + totals.neutral + totals.negative;
    const suppressed = sampleSize > 0 && sampleSize < this.minimumSampleSize;
    const ratingTotal = [...timeline.values()].reduce((sum, point) => sum + point.ratingTotal, 0);

    return {
      period: filters.period,
      sampleSize,
      minimumSampleSize: this.minimumSampleSize,
      suppressed,
      averageRating: sampleSize === 0 || suppressed
        ? null
        : Math.round((ratingTotal / sampleSize) * 100) / 100,
      distribution: suppressed ? { positive: 0, neutral: 0, negative: 0 } : totals,
      timeline: suppressed
        ? []
        : [...timeline.values()].map(({ ratingTotal: _ratingTotal, ratingCount, ...point }) => ({
            ...point,
            averageRating: ratingCount === 0
              ? null
              : Math.round((_ratingTotal / ratingCount) * 100) / 100,
          })),
    };
  }

  async exportCsv(filters: AnalyticsFilters, type: AnalyticsExportType): Promise<string> {
    if (type === 'student_trends') {
      const data = await this.getStudentTrends(filters) as {
        timeline: Array<{ period: string; assessments: number; testResults: number }>;
        suppressed: boolean;
      };
      if (data.suppressed) return csv([['Thông báo'], ['Dữ liệu bị ẩn do chưa đủ ngưỡng mẫu.']]);
      return csv([
        ['Kỳ', 'Assessment', 'Kết quả test', 'Tổng sự kiện'],
        ...data.timeline.map((item) => [
          item.period,
          item.assessments,
          item.testResults,
          item.assessments + item.testResults,
        ]),
      ]);
    }

    if (type === 'feedback') {
      const data = await this.getFeedback(filters) as {
        timeline: Array<{
          period: string;
          positive: number;
          neutral: number;
          negative: number;
          averageRating: number | null;
        }>;
        suppressed: boolean;
      };
      if (data.suppressed) return csv([['Thông báo'], ['Dữ liệu bị ẩn do chưa đủ ngưỡng mẫu.']]);
      return csv([
        ['Kỳ', 'Tích cực', 'Trung lập', 'Tiêu cực', 'Điểm trung bình'],
        ...data.timeline.map((item) => [
          item.period,
          item.positive,
          item.neutral,
          item.negative,
          item.averageRating,
        ]),
      ]);
    }

    const [studentTrends, feedback] = await Promise.all([
      this.getStudentTrends(filters),
      this.getFeedback(filters),
    ]) as [
      {
        sampleSize: number;
        suppressed: boolean;
        totalAssessments: number;
        totalTestResults: number;
      },
      { sampleSize: number; suppressed: boolean; averageRating: number | null },
    ];
    if (studentTrends.suppressed || feedback.suppressed) {
      return csv([['Thông báo'], ['Dữ liệu bị ẩn do chưa đủ ngưỡng mẫu.']]);
    }
    return csv([
      ['Chỉ số', 'Giá trị'],
      ['Tổng assessment', studentTrends.totalAssessments],
      ['Tổng kết quả test', studentTrends.totalTestResults],
      ['Tổng feedback', feedback.sampleSize],
      ['Điểm feedback trung bình', feedback.averageRating],
    ]);
  }

  recordAudit(
    actorRole: string,
    action: string,
    entityType: string,
    entityId?: string | null,
  ): Promise<void> {
    return this.repository.recordAudit(actorRole, action, entityType, entityId);
  }

  listAuditLogs(limit: number): Promise<AuditLogRow[]> {
    return this.repository.listAuditLogs(limit);
  }
}
