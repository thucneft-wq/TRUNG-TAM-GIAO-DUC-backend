import type { Request, Response } from 'express';
import {
  counselorIdSchema,
  createCounselorSchema,
  periodSchema,
  updateCounselorSchema,
} from '../schemas/counselorSchemas.js';
import type { AnalyticsServicePort, CounselorServicePort } from '../types/services.js';

export class CounselorController {
  constructor(
    private readonly counselorService: CounselorServicePort,
    private readonly analyticsService: AnalyticsServicePort,
  ) {}

  list = async (request: Request, response: Response): Promise<void> => {
    const period = periodSchema.parse(request.query.period);
    const counselors = await this.counselorService.list(period);
    response.status(200).json({ period, counselors });
  };

  getById = async (request: Request, response: Response): Promise<void> => {
    const id = counselorIdSchema.parse(request.params.id);
    const period = periodSchema.parse(request.query.period);
    const counselor = await this.counselorService.getById(id, period);
    response.status(200).json({ period, counselor });
  };

  create = async (request: Request, response: Response): Promise<void> => {
    const input = createCounselorSchema.parse(request.body);
    const counselor = await this.counselorService.create(input, 'this_month');
    await this.analyticsService.recordAudit(
      request.auth?.role ?? 'unknown',
      'CREATE_COUNSELOR',
      'Counselor',
      counselor.id,
    );
    response.status(201).json({ counselor });
  };

  update = async (request: Request, response: Response): Promise<void> => {
    const id = counselorIdSchema.parse(request.params.id);
    const period = periodSchema.parse(request.query.period);
    const input = updateCounselorSchema.parse(request.body);
    const counselor = await this.counselorService.update(id, input, period);
    await this.analyticsService.recordAudit(
      request.auth?.role ?? 'unknown',
      'UPDATE_COUNSELOR',
      'Counselor',
      id,
    );
    response.status(200).json({ counselor });
  };

  deactivate = async (request: Request, response: Response): Promise<void> => {
    const id = counselorIdSchema.parse(request.params.id);
    await this.counselorService.deactivate(id);
    await this.analyticsService.recordAudit(
      request.auth?.role ?? 'unknown',
      'DEACTIVATE_COUNSELOR',
      'Counselor',
      id,
    );
    response.status(204).send();
  };
}
