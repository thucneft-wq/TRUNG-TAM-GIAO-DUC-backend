import type { SheetMirrorPage, SheetMirrorServicePort } from '../types/services.js';
import { AppError } from '../utils/appError.js';

export const WEB_SHEET_TABLES = [
  'students',
  'counselors',
  'parents',
  'student_parents',
  'schools',
  'addresses',
  'counseling_requests',
  'bookings',
  'sessions',
  'availability_slots',
  'counselor_schedules',
  'counselor_assignments',
  'counselor_assignment_records',
  'session_feedback_surveys',
  'feedbacks',
  'treatment_plans',
  'tests',
  'test_assignments',
  'test_attempts',
  'assessments',
  'results',
  'consents',
  'notifications',
  'zalo_mappings',
  'audit_logs',
] as const;

export type WebSheetTable = (typeof WEB_SHEET_TABLES)[number];

type Fetcher = typeof fetch;
const SHEET_API_TIMEOUT_MS = 30_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSheetMirrorPage = (value: unknown): value is SheetMirrorPage => {
  if (!isRecord(value) || value.ok !== true || !Array.isArray(value.data)) return false;
  return typeof value.table === 'string'
    && typeof value.total === 'number'
    && typeof value.page === 'number'
    && typeof value.pageSize === 'number';
};

export class SheetMirrorService implements SheetMirrorServicePort {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async readTable(table: string, page: number, pageSize: number): Promise<SheetMirrorPage> {
    if (!WEB_SHEET_TABLES.includes(table as WebSheetTable)) {
      throw new AppError(400, 'The requested Sheet table is not allowed.', 'SHEET_TABLE_NOT_ALLOWED');
    }

    const url = new URL(this.endpoint);
    url.searchParams.set('table', table);
    url.searchParams.set('page', String(page));
    // Apps Script names this bounded row count "limit".
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('key', this.apiKey);

    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(SHEET_API_TIMEOUT_MS),
      });
    } catch (error) {
      throw new AppError(502, 'The Web Sheet API could not be reached.', 'SHEET_API_UNAVAILABLE', {
        cause: error instanceof Error ? error.message : 'unknown',
      });
    }

    if (!response.ok) {
      throw new AppError(502, 'The Web Sheet API returned an invalid HTTP response.', 'SHEET_API_BAD_RESPONSE');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AppError(502, 'The Web Sheet API returned invalid JSON.', 'SHEET_API_INVALID_JSON');
    }

    if (!isSheetMirrorPage(payload)) {
      const remoteError = isRecord(payload) && typeof payload.error === 'string'
        ? payload.error
        : 'invalid_payload';
      throw new AppError(502, 'The Web Sheet API rejected the request.', 'SHEET_API_REJECTED', {
        remoteError,
      });
    }

    return payload;
  }
}
