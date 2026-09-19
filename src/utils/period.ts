import type { PeriodRange, ReportingPeriod } from '../types/counselor.js';

const HO_CHI_MINH_OFFSET_MS = 7 * 60 * 60 * 1000;

const monthBoundaryInHoChiMinh = (date: Date, monthOffset = 0): Date => {
  const localClock = new Date(date.getTime() + HO_CHI_MINH_OFFSET_MS);
  return new Date(
    Date.UTC(localClock.getUTCFullYear(), localClock.getUTCMonth() + monthOffset, 1)
      - HO_CHI_MINH_OFFSET_MS,
  );
};

export const getPeriodRange = (
  period: ReportingPeriod,
  now: Date = new Date(),
): PeriodRange => {
  const thisMonthStart = monthBoundaryInHoChiMinh(now);

  if (period === 'this_month') {
    return {
      start: thisMonthStart,
      end: monthBoundaryInHoChiMinh(now, 1),
    };
  }

  if (period === 'last_month') {
    return {
      start: monthBoundaryInHoChiMinh(now, -1),
      end: thisMonthStart,
    };
  }

  return {
    start: new Date('1970-01-01T00:00:00.000Z'),
    end: monthBoundaryInHoChiMinh(now, 1),
  };
};

export const safePercentage = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : Math.round((numerator / denominator) * 10_000) / 100;
