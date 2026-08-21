import type { CreateCounselorInput, CounselorDto, ReportingPeriod, UpdateCounselorInput } from './counselor.js';
import type {
  AnalyticsExportType,
  AnalyticsFilterOptions,
  AnalyticsFilters,
  AuditLogRow,
} from './analytics.js';
import type {
  CreateStudentInput,
  StudentAccessScope,
  StudentDto,
  UpdateStudentInput,
} from './student.js';
import type {
  CounselorAccountSyncResult,
  GoogleSheetsCounselorAccountInput,
  GoogleSheetsCounselorInput,
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
}

export interface CounselorAccountServicePort {
  syncFromGoogleSheets(
    input: GoogleSheetsCounselorAccountInput,
  ): Promise<CounselorAccountSyncResult>;
}

export interface StudentServicePort {
  list(scope: StudentAccessScope): Promise<StudentDto[]>;
  getById(id: string, scope: StudentAccessScope): Promise<StudentDto>;
  create(input: CreateStudentInput, scope: StudentAccessScope): Promise<StudentDto>;
  update(id: string, input: UpdateStudentInput, scope: StudentAccessScope): Promise<StudentDto>;
  deactivate(id: string, scope: StudentAccessScope): Promise<void>;
  syncFromGoogleSheets(input: CreateStudentInput): Promise<{ student: StudentDto; created: boolean }>;
}

export interface DashboardServicePort {
  get(period: ReportingPeriod): Promise<Record<string, unknown>>;
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
