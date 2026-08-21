import type { Request, Response } from 'express';

export class HealthController {
  constructor(private readonly checkDatabase: () => Promise<void>) {}

  get = async (_request: Request, response: Response): Promise<void> => {
    try {
      await this.checkDatabase();
      response.status(200).json({ status: 'ok', database: 'connected' });
    } catch {
      response.status(503).json({ status: 'degraded', database: 'unavailable' });
    }
  };
}
