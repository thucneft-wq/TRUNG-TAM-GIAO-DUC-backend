import type { Request, Response } from 'express';

export class HealthController {
  constructor(private readonly checkDatabase: () => Promise<void>) {}

  get = async (_request: Request, response: Response): Promise<void> => {
    try {
      await this.checkDatabase();
      response.status(200).json({ status: 'ok', database: 'connected' });
    } catch (error) {
      const databaseError = error as { name?: unknown; code?: unknown; message?: unknown };
      console.error('Database health check failed', {
        name: typeof databaseError.name === 'string' ? databaseError.name : 'Error',
        code: typeof databaseError.code === 'string' ? databaseError.code : 'UNKNOWN',
        message: typeof databaseError.message === 'string'
          ? databaseError.message
          : 'Unknown database connection error',
      });
      response.status(503).json({ status: 'degraded', database: 'unavailable' });
    }
  };
}
