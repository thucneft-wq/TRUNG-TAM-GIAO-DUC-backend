import { randomUUID } from 'node:crypto';
import type {
  SheetMirrorPage,
  SheetMirrorReadContext,
  SheetMirrorServicePort,
} from '../types/services.js';
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
const SHEET_API_TIMEOUT_MS = 8_000;
const SHEET_CACHE_TTL_MS = 20_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finiteDuration = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
};

const logSheetMirror = (entry: Record<string, unknown>): void => {
  console.info(JSON.stringify({ event: 'sheet_mirror_request', ...entry }));
};

const isSheetMirrorPage = (value: unknown): value is SheetMirrorPage => {
  if (!isRecord(value) || value.ok !== true || !Array.isArray(value.data)) return false;
  return typeof value.table === 'string'
    && typeof value.total === 'number'
    && typeof value.page === 'number'
    && typeof value.pageSize === 'number';
};

export class SheetMirrorService implements SheetMirrorServicePort {
  private readonly cache = new Map<string, { expiresAt: number; value: SheetMirrorPage }>();

  private readonly inFlight = new Map<string, Promise<SheetMirrorPage>>();

  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async readTable(
    table: string,
    page: number,
    pageSize: number,
    context?: SheetMirrorReadContext,
  ): Promise<SheetMirrorPage> {
    const requestId = context?.requestId || randomUUID();
    const startedAt = new Date();
    const startedMs = performance.now();
    if (!WEB_SHEET_TABLES.includes(table as WebSheetTable)) {
      throw new AppError(400, 'The requested Sheet table is not allowed.', 'SHEET_TABLE_NOT_ALLOWED');
    }

    const cacheKey = `${table}:${page}:${pageSize}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      const backendDurationMs = Math.round(performance.now() - startedMs);
      logSheetMirror({
        requestId,
        table,
        page,
        pageSize,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: backendDurationMs,
        rowCount: cached.value.data.length,
        cacheHit: true,
        result: 'success',
      });
      return {
        ...cached.value,
        timing: {
          cacheHit: true,
          backendDurationMs,
          upstreamDurationMs: 0,
          parseDurationMs: 0,
          appsScriptDurationMs: null,
        },
      };
    }

    const pending = this.inFlight.get(cacheKey);
    if (pending) {
      const value = await pending;
      const backendDurationMs = Math.round(performance.now() - startedMs);
      logSheetMirror({
        requestId,
        table,
        page,
        pageSize,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: backendDurationMs,
        rowCount: value.data.length,
        cacheHit: true,
        result: 'success',
      });
      return {
        ...value,
        timing: { ...value.timing!, cacheHit: true, backendDurationMs },
      };
    }

    const request = this.fetchTable(table, page, pageSize);
    this.inFlight.set(cacheKey, request);
    try {
      const value = await request;
      this.cache.set(cacheKey, { expiresAt: Date.now() + SHEET_CACHE_TTL_MS, value });
      const backendDurationMs = Math.round(performance.now() - startedMs);
      const result = {
        ...value,
        timing: { ...value.timing!, cacheHit: false, backendDurationMs },
      };
      logSheetMirror({
        requestId,
        table,
        page,
        pageSize,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: backendDurationMs,
        upstreamDurationMs: result.timing.upstreamDurationMs,
        parseDurationMs: result.timing.parseDurationMs,
        appsScriptDurationMs: result.timing.appsScriptDurationMs,
        rowCount: value.data.length,
        cacheHit: false,
        result: 'success',
      });
      return result;
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedMs);
      logSheetMirror({
        requestId,
        table,
        page,
        pageSize,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        durationMs,
        rowCount: 0,
        cacheHit: false,
        result: error instanceof AppError && error.code === 'SHEET_API_TIMEOUT'
          ? 'timeout'
          : 'error',
      });
      throw error;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  private async fetchTable(table: string, page: number, pageSize: number): Promise<SheetMirrorPage> {
    const url = new URL(this.endpoint);
    url.searchParams.set('table', table);
    url.searchParams.set('page', String(page));
    // Apps Script names this bounded row count "limit".
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('key', this.apiKey);

    let response: Response;
    const upstreamStartedMs = performance.now();
    try {
      response = await this.fetcher(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(SHEET_API_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof DOMException
        && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new AppError(502, timedOut
        ? 'The Web Sheet API timed out.'
        : 'The Web Sheet API could not be reached.', timedOut
        ? 'SHEET_API_TIMEOUT'
        : 'SHEET_API_UNAVAILABLE', {
        cause: error instanceof Error ? error.message : 'unknown',
      });
    }
    const upstreamDurationMs = Math.round(performance.now() - upstreamStartedMs);

    if (!response.ok) {
      throw new AppError(502, 'The Web Sheet API returned an invalid HTTP response.', 'SHEET_API_BAD_RESPONSE');
    }

    let payload: unknown;
    const parseStartedMs = performance.now();
    try {
      payload = await response.json();
    } catch {
      throw new AppError(502, 'The Web Sheet API returned invalid JSON.', 'SHEET_API_INVALID_JSON');
    }
    const parseDurationMs = Math.round(performance.now() - parseStartedMs);

    if (!isSheetMirrorPage(payload)) {
      const remoteError = isRecord(payload) && typeof payload.error === 'string'
        ? payload.error
        : 'invalid_payload';
      throw new AppError(502, 'The Web Sheet API rejected the request.', 'SHEET_API_REJECTED', {
        remoteError,
      });
    }

    const rawPayload = payload as unknown as Record<string, unknown>;
    const remoteTiming = isRecord(rawPayload.timing) ? rawPayload.timing : null;
    return {
      ...payload,
      timing: {
        cacheHit: false,
        backendDurationMs: 0,
        upstreamDurationMs,
        parseDurationMs,
        appsScriptDurationMs: finiteDuration(
          remoteTiming?.durationMs ?? rawPayload.durationMs,
        ),
      },
    };
  }
}
