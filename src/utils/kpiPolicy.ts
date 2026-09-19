import type { KpiComparison, KpiItem, OverallStatus } from '../types/counselor.js';

export const PERFORMANCE_KPI_COUNT = 4;
export const REQUIRED_PASSED_KPIS = 3;
export const MINIMUM_FEEDBACK_SAMPLE_SIZE = 5;
export const MINIMUM_ELIGIBLE_SESSIONS = 5;
export const MINIMUM_ASSIGNED_ASSESSMENTS = 3;

export interface KpiDefinition {
  id: string;
  name: string;
  category: string;
  targetNumeric: number;
  targetValue: string;
  comparisonType: KpiComparison;
  unit: string;
  weight: number;
  hardGuardrail?: boolean;
}

export const KPI_DEFINITIONS: readonly KpiDefinition[] = [
  {
    id: 'weighted-caseload-capacity',
    name: 'Tải hồ sơ đang phụ trách',
    category: 'Safety and Workload',
    targetNumeric: 20,
    targetValue: 'Không quá 20 hồ sơ quy đổi/FTE',
    comparisonType: 'lte',
    unit: 'hồ sơ quy đổi',
    weight: 15,
    hardGuardrail: true,
  },
  {
    id: 'student-service-time',
    name: 'Thời lượng phục vụ học sinh',
    category: 'Service Allocation',
    targetNumeric: 80,
    targetValue: '>= 80% of registered service time',
    comparisonType: 'gte',
    unit: '%',
    weight: 20,
  },
  {
    id: 'eligible-session-completion',
    name: 'Tỷ lệ hoàn thành phiên tham vấn',
    category: 'Continuity of Care',
    targetNumeric: 80,
    targetValue: '>= 80% of eligible due sessions',
    comparisonType: 'gte',
    unit: '%',
    weight: 25,
  },
  {
    id: 'assessment-follow-through',
    name: 'Tỷ lệ hoàn thành bài đánh giá',
    category: 'Appropriate Assessment',
    targetNumeric: 80,
    targetValue: '>= 80% of eligible assigned assessments',
    comparisonType: 'gte',
    unit: '%',
    weight: 20,
  },
  {
    id: 'student-outcome-experience',
    name: 'Kết quả và trải nghiệm học sinh',
    category: 'Perceived Outcome',
    targetNumeric: 80,
    targetValue: '>= 80% with at least 5 responses',
    comparisonType: 'gte',
    unit: '%',
    weight: 20,
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

export const evaluateKpiValue = (
  definition: KpiDefinition,
  actual: number | null,
  evidence?: KpiItem['evidence'],
): boolean => {
  if (!isKpiValueEvaluable(definition, actual, evidence)) return false;

  return evaluateValue(actual, definition.targetNumeric, definition.comparisonType);
};

export const isKpiValueEvaluable = (
  definition: KpiDefinition,
  actual: number | null,
  evidence?: KpiItem['evidence'],
): boolean => {
  if (actual === null || !Number.isFinite(actual)) return false;
  switch (definition.id) {
    case 'weighted-caseload-capacity':
      return actual > 0;
    case 'student-service-time':
      return (evidence?.registeredHours ?? evidence?.denominator ?? 0) > 0;
    case 'eligible-session-completion':
      return (evidence?.denominator ?? 0) >= MINIMUM_ELIGIBLE_SESSIONS;
    case 'assessment-follow-through':
      return (evidence?.denominator ?? 0) >= MINIMUM_ASSIGNED_ASSESSMENTS;
    case 'student-outcome-experience':
      return (evidence?.sampleSize ?? 0)
        >= (evidence?.minimumSampleSize ?? MINIMUM_FEEDBACK_SAMPLE_SIZE);
    default:
      return true;
  }
};

export const calculateKpiScore = (
  definition: KpiDefinition,
  actual: number | null,
  evidence?: KpiItem['evidence'],
): number => {
  if (actual === null || !Number.isFinite(actual) || actual < 0) return 0;
  if (!isKpiValueEvaluable(definition, actual, evidence)) return 0;

  const ratio = definition.comparisonType === 'gte'
    ? actual / definition.targetNumeric
    : actual <= definition.targetNumeric
      ? 1
      : definition.targetNumeric / actual;

  return Math.round(Math.min(Math.max(ratio, 0), 1) * 10000) / 100;
};

export const evaluateKpiSet = (kpis: KpiItem[]): {
  passedKpis: number;
  evaluableKpis: number;
  failedKpis: number;
  insufficientDataKpis: number;
  totalKpis: 5;
  overallScore: number;
  overallStatus: OverallStatus;
} => {
  const expectedIds = new Set(KPI_DEFINITIONS.map((definition) => definition.id));
  const uniqueIds = new Set(kpis.map((kpi) => kpi.id));
  const validSet =
    kpis.length === 5
    && uniqueIds.size === 5
    && [...expectedIds].every((id) => uniqueIds.has(id));
  const isEvaluable = (kpi: KpiItem): boolean => {
    const definition = KPI_DEFINITIONS.find((item) => item.id === kpi.id);
    return definition
      ? isKpiValueEvaluable(definition, kpi.actualNumeric, kpi.evidence)
      : kpi.actualNumeric !== null && Number.isFinite(kpi.actualNumeric);
  };
  const performanceKpis = kpis.filter((kpi) => !kpi.hardGuardrail);
  const guardrailKpis = kpis.filter((kpi) => kpi.hardGuardrail);
  const evaluableKpis = performanceKpis.filter(isEvaluable).length;
  const passedKpis = performanceKpis.filter((kpi) => isEvaluable(kpi) && kpi.isPassed).length;
  const failedKpis = performanceKpis.filter((kpi) => isEvaluable(kpi) && !kpi.isPassed).length;
  const insufficientDataKpis = Math.max(0, PERFORMANCE_KPI_COUNT - evaluableKpis);
  const performanceWeight = performanceKpis.reduce((sum, kpi) => sum + kpi.weight, 0);
  const overallScore = performanceWeight > 0
    ? Math.round((performanceKpis.reduce(
        (sum, kpi) => sum + kpi.score * kpi.weight,
        0,
      ) / performanceWeight) * 100) / 100
    : 0;
  const guardrailsEvaluable = guardrailKpis.length > 0
    && guardrailKpis.every(isEvaluable);
  const guardrailsPassed = guardrailsEvaluable
    && guardrailKpis.every((kpi) => kpi.isPassed);

  return {
    passedKpis,
    evaluableKpis,
    failedKpis,
    insufficientDataKpis,
    totalKpis: 5,
    overallScore,
    overallStatus: !validSet || !guardrailsEvaluable
      ? 'Insufficient Data'
      : !guardrailsPassed
        ? 'Not Pass'
        : evaluableKpis < REQUIRED_PASSED_KPIS
          ? 'Insufficient Data'
          : passedKpis >= REQUIRED_PASSED_KPIS
            ? 'Pass'
            : 'Not Pass',
  };
};
