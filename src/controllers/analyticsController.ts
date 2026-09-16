import type { Request, Response } from 'express';
import {
  analyticsExportQuerySchema,
  analyticsQuerySchema,
  auditLogQuerySchema,
} from '../schemas/analyticsSchemas.js';
import type { AnalyticsFilters } from '../types/analytics.js';
import type { AnalyticsServicePort } from '../types/services.js';
import { getPeriodRange } from '../utils/period.js';

const parseFilters = (query: Request['query']): AnalyticsFilters => {
  const input = analyticsQuerySchema.parse(query);
  return {
    period: input.period,
    range: getPeriodRange(input.period),
    counselorId: input.counselorId ?? null,
    testId: input.testId ?? null,
    category: input.category ?? null,
  };
};

export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsServicePort) {}

  filters = async (_request: Request, response: Response): Promise<void> => {
    response.status(200).json(await this.analyticsService.getFilterOptions());
  };

  studentTrends = async (request: Request, response: Response): Promise<void> => {
    response.status(200).json(await this.analyticsService.getStudentTrends(parseFilters(request.query)));
  };

  feedback = async (request: Request, response: Response): Promise<void> => {
    response
      .status(200)
      .setHeader('Cache-Control', 'no-store')
      .json(await this.analyticsService.getFeedback(parseFilters(request.query)));
  };

  export = async (request: Request, response: Response): Promise<void> => {
    const input = analyticsExportQuerySchema.parse(request.query);
    const filters: AnalyticsFilters = {
      period: input.period,
      range: getPeriodRange(input.period),
      counselorId: input.counselorId ?? null,
      testId: input.testId ?? null,
      category: input.category ?? null,
    };
    const content = await this.analyticsService.exportCsv(filters, input.type);
    await this.analyticsService.recordAudit(
      request.auth?.role ?? 'unknown',
      'EXPORT_ANALYTICS',
      input.type,
    );
    response
      .status(200)
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader('Content-Disposition', `attachment; filename="${input.type}-${input.period}.csv"`)
      .send(content);
  };

  auditLogs = async (request: Request, response: Response): Promise<void> => {
    const { limit } = auditLogQuerySchema.parse(request.query);
    response.status(200).json({ auditLogs: await this.analyticsService.listAuditLogs(limit) });
  };
}
