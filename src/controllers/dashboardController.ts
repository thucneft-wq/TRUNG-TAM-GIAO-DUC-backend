import type { Request, Response } from 'express';
import { periodSchema } from '../schemas/counselorSchemas.js';
import type { DashboardServicePort } from '../types/services.js';

export class DashboardController {
  constructor(private readonly dashboardService: DashboardServicePort) {}

  get = async (request: Request, response: Response): Promise<void> => {
    const period = periodSchema.parse(request.query.period);
    response.status(200).json(await this.dashboardService.get(period));
  };
}
