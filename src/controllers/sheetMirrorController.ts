import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { WEB_SHEET_TABLES } from '../services/sheetMirrorService.js';
import type { SheetMirrorServicePort } from '../types/services.js';

const paramsSchema = z.object({
  table: z.enum(WEB_SHEET_TABLES),
});

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

export class SheetMirrorController {
  constructor(private readonly service: SheetMirrorServicePort) {}

  readTable = async (request: Request, response: Response): Promise<void> => {
    const { table } = paramsSchema.parse(request.params);
    const { page, pageSize } = querySchema.parse(request.query);
    const providedRequestId = request.header('x-request-id')?.trim();
    const requestId = providedRequestId && providedRequestId.length <= 128
      ? providedRequestId
      : randomUUID();
    const result = await this.service.readTable(table, page, pageSize, { requestId });
    const timing = result.timing;
    response.setHeader('X-Request-Id', requestId);
    if (timing) {
      response.setHeader('Server-Timing', [
        `sheet_proxy;dur=${timing.backendDurationMs}`,
        `sheet_upstream;dur=${timing.upstreamDurationMs}`,
        `sheet_parse;dur=${timing.parseDurationMs}`,
        timing.appsScriptDurationMs === null
          ? null
          : `apps_script;dur=${timing.appsScriptDurationMs}`,
      ].filter(Boolean).join(', '));
    }
    response.status(200).json(result);
  };
}
