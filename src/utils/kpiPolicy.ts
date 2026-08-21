import type { KpiComparison, KpiItem, OverallStatus } from '../types/counselor.js';

export interface KpiDefinition {
  id: string;
  name: string;
  category: string;
  targetNumeric: number;
  targetValue: string;
  comparisonType: KpiComparison;
  unit: string;
}

export const KPI_DEFINITIONS: readonly KpiDefinition[] = [
  {
    id: 'caseload-compliance',
    name: 'Caseload Compliance',
    category: 'Workload',
    targetNumeric: 30,
    targetValue: '<= 30 students',
    comparisonType: 'lte',
    unit: 'students',
  },
  {
    id: 'session-completion-rate',
    name: 'Session Completion Rate',
    category: 'Service Delivery',
    targetNumeric: 80,
    targetValue: '>= 80%',
    comparisonType: 'gte',
    unit: '%',
  },
  {
    id: 'booking-cancellation-rate',
    name: 'Booking Cancellation Rate',
    category: 'Booking Quality',
    targetNumeric: 10,
    targetValue: '<= 10%',
    comparisonType: 'lte',
    unit: '%',
  },
  {
    id: 'test-completion-rate',
    name: 'Test Completion Rate',
    category: 'Assessment Follow-through',
    targetNumeric: 80,
    targetValue: '>= 80%',
    comparisonType: 'gte',
    unit: '%',
  },
  {
    id: 'student-satisfaction',
    name: 'Student Satisfaction',
    category: 'Student Experience',
    targetNumeric: 4,
    targetValue: '>= 4.0 / 5.0',
    comparisonType: 'gte',
    unit: '/ 5.0',
  },
];

export const evaluateValue = (
  actual: number | null,
  target: number,
  comparison: KpiComparison,
): boolean => {
  if (actual === null || !Number.isFinite(actual)) return false;
  return comparison === 'gte' ? actual >= target : actual <= target;
};

export const evaluateKpiSet = (kpis: KpiItem[]): {
  passedKpis: number;
  totalKpis: 5;
  overallStatus: OverallStatus;
} => {
  const expectedIds = new Set(KPI_DEFINITIONS.map((definition) => definition.id));
  const uniqueIds = new Set(kpis.map((kpi) => kpi.id));
  const validSet =
    kpis.length === 5 &&
    uniqueIds.size === 5 &&
    [...expectedIds].every((id) => uniqueIds.has(id));
  const passedKpis = kpis.filter((kpi) => kpi.isPassed).length;

  return {
    passedKpis,
    totalKpis: 5,
    overallStatus: validSet && passedKpis === 5 ? 'Pass' : 'Not Pass',
  };
};
