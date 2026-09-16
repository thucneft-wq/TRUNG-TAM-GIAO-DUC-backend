import { Pool, type PoolConfig } from 'pg';

export const createDatabasePool = (connectionString: string): Pool => {
  const isLocal =
    connectionString.includes('localhost') ||
    connectionString.includes('127.0.0.1') ||
    connectionString.includes('sslmode=disable');

  const config: PoolConfig = {
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  };

  if (!isLocal) {
    config.ssl = { rejectUnauthorized: false };
  }

  return new Pool(config);
};

