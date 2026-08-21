import type { PeriodRange, ReportingPeriod } from '../types/counselor.js';

const startOfUtcMonth = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

export const getPeriodRange = (
  period: ReportingPeriod,
  now: Date = new Date(),
): PeriodRange => {
  const thisMonthStart = startOfUtcMonth(now);

  if (period === 'this_month') {
    return {
      start: thisMonthStart,
      end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    };
  }

  if (period === 'last_month') {
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
      end: thisMonthStart,
    };
  }

  return {
    start: new Date('1970-01-01T00:00:00.000Z'),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
};

export const safePercentage = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : Math.round((numerator / denominator) * 10_000) / 100;
