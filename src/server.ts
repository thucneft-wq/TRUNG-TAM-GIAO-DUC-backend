// Load shared settings first, then allow ignored local credentials to override them.
import { config as loadDotEnv } from 'dotenv';
import express from 'express';

loadDotEnv();
loadDotEnv({ path: '.env.local', override: true });
import { createApp } from './application.js';
import { loadConfig } from './config/env.js';
import { createDatabaseHealthCheck } from './database/health.js';
import { createDatabasePool } from './database/pool.js';
import { PgAnalyticsRepository } from './repositories/analyticsRepository.js';
import { PgCounselorRepository } from './repositories/counselorRepository.js';
import { PgCounselorAccountRepository } from './repositories/counselorAccountRepository.js';
import { PgFeedbackRepository } from './repositories/feedbackRepository.js';
import { PgStudentRepository } from './repositories/studentRepository.js';
import { AnalyticsService } from './services/analyticsService.js';
import { AuthService } from './services/authService.js';
import { CounselorService } from './services/counselorService.js';
import { CounselorAccountService } from './services/counselorAccountService.js';
import { DashboardService } from './services/dashboardService.js';
import { FeedbackService } from './services/feedbackService.js';
import { StudentService } from './services/studentService.js';

// Keep a direct runtime import so Vercel recognizes this file as the Express entrypoint.
void express;

const config = loadConfig();
const pool = createDatabasePool(config.databaseUrl);
const counselorRepository = new PgCounselorRepository(pool);
const counselorAccountRepository = new PgCounselorAccountRepository(pool);
const analyticsRepository = new PgAnalyticsRepository(pool);
const studentRepository = new PgStudentRepository(pool);
const feedbackRepository = new PgFeedbackRepository(pool);
const counselorService = new CounselorService(counselorRepository);
const analyticsService = new AnalyticsService(
  analyticsRepository,
  config.minimumAnalyticsSampleSize,
);
const studentService = new StudentService(studentRepository);
const accounts = [
  {
    id: 'admin',
    name: 'Admin Supervisor',
    email: config.adminEmail,
    passwordHash: config.adminPasswordHash,
    role: 'admin' as const,
  },
];
const app = createApp({
  authService: new AuthService(accounts, config.jwtSecret),
  counselorService,
  counselorAccountService: new CounselorAccountService(counselorAccountRepository),
  dashboardService: new DashboardService(counselorRepository, counselorService),
  analyticsService,
  feedbackService: new FeedbackService(feedbackRepository),
  studentService,
  checkDatabase: createDatabaseHealthCheck(pool),
  jwtSecret: config.jwtSecret,
  corsOrigins: config.corsOrigins,
  googleSheetsSyncSecret: config.googleSheetsSyncSecret,
  webCrudEnabled: config.webCrudEnabled,
});

const server = app.listen(config.port, () => {
  console.log(`Digital Twin Backend listening on http://localhost:${config.port}`);
});

export default app;

const shutdown = (signal: string) => {
  console.log(`${signal} received; shutting down.`);
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
