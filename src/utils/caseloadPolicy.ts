import type { PeriodRange } from '../types/counselor.js';

export interface CaseloadIntervalRow {
  counselor_id: string;
  student_id: string | null;
  assigned_at: Date | string | null;
  ended_at: Date | string | null;
  assignment_status: string | null;
  record_status: string | null;
  case_weight: number | string | null;
}

export interface CaseloadPeriodResult {
  assignedStudents: number | null;
  weightedCaseloadPoints: number | null;
  dataComplete: boolean;
  missingFields: string[];
}

const parseDate = (value: Date | string | null): Date | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizedStatus = (value: string | null): string => value?.trim().toUpperCase() ?? '';

const validWeight = (value: number | string | null): number => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

export const calculatePeakCaseload = (
  records: CaseloadIntervalRow[],
  range: PeriodRange,
): CaseloadPeriodResult => {
  const missingFields = new Set<string>();
  const intervals: Array<{
    studentId: string;
    assignedAt: Date;
    endedAt: Date | null;
    weight: number;
  }> = [];

  records.forEach((record) => {
    const assignedAt = parseDate(record.assigned_at);
    const endedAt = parseDate(record.ended_at);
    if (endedAt && endedAt <= range.start) return;
    if (assignedAt && assignedAt >= range.end) return;

    if (!record.student_id) missingFields.add('student_id');
    if (!assignedAt) missingFields.add('assigned_at');
    if (
      !endedAt
      && (
        normalizedStatus(record.assignment_status) === 'INACTIVE'
        || normalizedStatus(record.record_status) === 'INACTIVE'
      )
    ) {
      missingFields.add('ended_at');
    }
    if (assignedAt && endedAt && endedAt < assignedAt) missingFields.add('ended_at');
    if (
      endedAt
      && (
        normalizedStatus(record.assignment_status) === 'ACTIVE'
        || normalizedStatus(record.record_status) === 'ACTIVE'
      )
    ) {
      missingFields.add('status');
    }

    if (!record.student_id || !assignedAt || (endedAt && endedAt < assignedAt)) return;
    intervals.push({
      studentId: record.student_id,
      assignedAt,
      endedAt,
      weight: validWeight(record.case_weight),
    });
  });

  if (missingFields.size > 0) {
    return {
      assignedStudents: null,
      weightedCaseloadPoints: null,
      dataComplete: false,
      missingFields: [...missingFields].sort(),
    };
  }

  const points = new Set<number>([range.start.getTime()]);
  intervals.forEach((interval) => {
    const point = Math.max(interval.assignedAt.getTime(), range.start.getTime());
    if (point < range.end.getTime()) points.add(point);
  });

  let peakPoints = 0;
  let peakStudents = 0;
  [...points].sort((left, right) => left - right).forEach((timestamp) => {
    const activeWeights = new Map<string, number>();
    intervals.forEach((interval) => {
      const active = interval.assignedAt.getTime() <= timestamp
        && (!interval.endedAt || interval.endedAt.getTime() > timestamp);
      if (!active) return;
      activeWeights.set(
        interval.studentId,
        Math.max(activeWeights.get(interval.studentId) ?? 0, interval.weight),
      );
    });
    const weightedPoints = [...activeWeights.values()].reduce((sum, weight) => sum + weight, 0);
    if (weightedPoints > peakPoints || (weightedPoints === peakPoints && activeWeights.size > peakStudents)) {
      peakPoints = weightedPoints;
      peakStudents = activeWeights.size;
    }
  });

  return {
    assignedStudents: peakStudents,
    weightedCaseloadPoints: Math.round(peakPoints * 100) / 100,
    dataComplete: true,
    missingFields: [],
  };
};
