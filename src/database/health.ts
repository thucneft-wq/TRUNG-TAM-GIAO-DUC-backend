import type { Pool } from 'pg';

export const createDatabaseHealthCheck = (pool: Pick<Pool, 'query'>) => async (): Promise<void> => {
  await pool.query('SELECT 1');
};
