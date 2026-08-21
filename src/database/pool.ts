import { Pool } from 'pg';

export const createDatabasePool = (connectionString: string): Pool =>
  new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
