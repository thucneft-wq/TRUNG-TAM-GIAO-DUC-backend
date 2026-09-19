import type {
  CounselorReconcileResult,
  CreateCounselorInput,
  CounselorDto,
  ReportingPeriod,
  UpdateCounselorInput,
} from './counselor.js';
import type {
  AnalyticsExportType,
  AnalyticsFilterOptions,
  AnalyticsFilters,
  AuditLogRow,
} from './analytics.js';
import type {
  CreateStudentInput,
  GoogleSheetsAssignmentInput,
  StudentAccessScope,
  StudentAssignmentSyncResult,
  StudentDto,
  StudentReconcileResult,
  UpdateStudentInput,
} from './student.js';
import type {
  CounselorAccountSyncResult,
  FeedbackSyncResult,
  GoogleSheetsCounselorAccountInput,
  GoogleSheetsCounselorInput,
  GoogleSheetsFeedbackInput,
} from './googleSheets.js';

export type InternalRole = 'admin' | 'counselor';

export interface AuthServicePort {
  login(email: string, password: string): Promise<{
    token: string;
    user: { id: string; name: string; email: string; role: InternalRole };
  }>;
}

export interface CounselorServicePort {
  list(period: ReportingPeriod): Promise<CounselorDto[]>;
  getById(id: string, period: ReportingPeriod): Promise<CounselorDto>;
  create(input: CreateCounselorInput, period: ReportingPeriod): Promise<CounselorDto>;
  update(id: string, input: UpdateCounselorInput, period: ReportingPeriod): Promise<CounselorDto>;
  deactivate(id: string): Promise<void>;
  syncFromGoogleSheets(
    input: GoogleSheetsCounselorInput,
  ): Promise<{ counselor: CounselorDto; created: boolean }>;
  reconcileFromGoogleSheets(
    activeExternalCounselorIds: string[],
    dryRun?: boolean,
  ): Promise<CounselorReconcileResult>;
}

export interface CounselorAccountServicePort {
  syncFromGoogleSheets(
    input: GoogleSheetsCounselorAccountInput,
  ): Promise<CounselorAccountSyncResult>;
}

export interface FeedbackServicePort {
  syncFromGoogleSheets(input: GoogleSheetsFeedbackInput): Promise<FeedbackSyncResult>;
}

export interface StudentServicePort {
  list(scope: StudentAccessScope): Promise<StudentDto[]>;
  getById(id: string, scope: StudentAccessScope): Promise<StudentDto>;
  create(input: CreateStudentInput, scope: StudentAccessScope): Promise<StudentDto>;
  update(id: string, input: UpdateStudentInput, scope: StudentAccessScope): Promise<StudentDto>;
  deactivate(id: string, scope: StudentAccessScope): Promise<void>;
  syncFromGoogleSheets(input: CreateStudentInput): Promise<{ student: StudentDto; created: boolean }>;
  syncAssignmentFromGoogleSheets(
    input: GoogleSheetsAssignmentInput,
  ): Promise<StudentAssignmentSyncResult>;
  reconcileFromGoogleSheets(activeExternalStudentIds: string[]): Promise<StudentReconcileResult>;
}

export interface DashboardServicePort {
  get(period: ReportingPeriod): Promise<Record<string, unknown>>;
}

export interface SheetMirrorPage {
  ok: true;
  table: string;
  lastSyncAt: string | null;
  total: number;
  page: number;
  pageSize: number;
  data: Array<Record<string, string>>;
  timing?: {
    cacheHit: boolean;
    backendDurationMs: number;
    upstreamDurationMs: number;
    parseDurationMs: number;
    appsScriptDurationMs: number | null;
  };
}

export interface SheetMirrorReadContext {
  requestId: string;
}

export interface SheetMirrorServicePort {
  readTable(
    table: string,
    page: number,
    pageSize: number,
    context?: SheetMirrorReadContext,
  ): Promise<SheetMirrorPage>;
}

export interface AnalyticsServicePort {
  getFilterOptions(): Promise<AnalyticsFilterOptions>;
  getStudentTrends(filters: AnalyticsFilters): Promise<Record<string, unknown>>;
  getFeedback(filters: AnalyticsFilters): Promise<Record<string, unknown>>;
  exportCsv(filters: AnalyticsFilters, type: AnalyticsExportType): Promise<string>;
  recordAudit(
    actorRole: string,
    action: string,
    entityType: string,
    entityId?: string | null,
  ): Promise<void>;
  listAuditLogs(limit: number): Promise<AuditLogRow[]>;
}
