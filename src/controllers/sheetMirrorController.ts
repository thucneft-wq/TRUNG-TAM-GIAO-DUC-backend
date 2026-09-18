import type { Request, Response } from 'express';
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
    response.status(200).json(await this.service.readTable(table, page, pageSize));
  };
}
