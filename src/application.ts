import cors from 'cors';
import express, { type Express } from 'express';
import { AnalyticsController } from './controllers/analyticsController.js';
import { AuthController } from './controllers/authController.js';
import { CounselorController } from './controllers/counselorController.js';
import { DashboardController } from './controllers/dashboardController.js';
import { HealthController } from './controllers/healthController.js';
import { GoogleSheetsController } from './controllers/googleSheetsController.js';
import { StudentController } from './controllers/studentController.js';
import { createAuthenticateMiddleware, requireRole } from './middleware/authenticate.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createAdminRouter } from './routes/adminRoutes.js';
import { createAuthRouter } from './routes/authRoutes.js';
import { createDocsRouter } from './routes/docsRoutes.js';
import { createHealthRouter } from './routes/healthRoutes.js';
import { createIntegrationRouter } from './routes/integrationRoutes.js';
import { createStudentRouter } from './routes/studentRoutes.js';
import type {
  AnalyticsServicePort,
  AuthServicePort,
  CounselorServicePort,
  CounselorAccountServicePort,
  DashboardServicePort,
  StudentServicePort,
} from './types/services.js';
import { AppError } from './utils/appError.js';

export interface AppDependencies {
  authService: AuthServicePort;
  counselorService: CounselorServicePort;
  counselorAccountService: CounselorAccountServicePort;
  dashboardService: DashboardServicePort;
  analyticsService: AnalyticsServicePort;
  studentService: StudentServicePort;
  checkDatabase: () => Promise<void>;
  jwtSecret: string;
  corsOrigins: string[];
  googleSheetsSyncSecret?: string;
  webCrudEnabled?: boolean;
}

export const createApp = (dependencies: AppDependencies): Express => {
  const app = express();
  const authController = new AuthController(dependencies.authService);
  const counselorController = new CounselorController(
    dependencies.counselorService,
    dependencies.analyticsService,
  );
  const googleSheetsController = new GoogleSheetsController(
    dependencies.counselorService,
    dependencies.counselorAccountService,
    dependencies.analyticsService,
  );
  const dashboardController = new DashboardController(dependencies.dashboardService);
  const analyticsController = new AnalyticsController(dependencies.analyticsService);
  const studentController = new StudentController(
    dependencies.studentService,
    dependencies.analyticsService,
  );
  const healthController = new HealthController(dependencies.checkDatabase);

  app.disable('x-powered-by');
  app.use(cors({
    credentials: true,
    origin: (origin, callback) => {
      if (!origin || dependencies.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new AppError(403, 'This origin is not allowed by CORS.', 'CORS_ORIGIN_DENIED'));
    },
  }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/', (_request, response) => {
    response.status(200).json({
      name: 'Digital Twin Backend',
      status: 'running',
      health: '/api/health',
      frontend: 'http://localhost:3000',
    });
  });

  app.use('/api/docs', createDocsRouter());
  app.use(['/health', '/api/health'], createHealthRouter(healthController));
  app.use('/api/auth', createAuthRouter(authController));
  app.use(
    '/api/integrations',
    createIntegrationRouter(
      studentController,
      googleSheetsController,
      dependencies.googleSheetsSyncSecret,
    ),
  );
  const authenticate = createAuthenticateMiddleware(dependencies.jwtSecret);
  app.use(
    '/api/students',
    authenticate,
    createStudentRouter(studentController, dependencies.webCrudEnabled ?? true),
  );
  app.use(
    '/api/admin',
    authenticate,
    requireRole('admin'),
    createAdminRouter(counselorController, dashboardController, analyticsController, dependencies.webCrudEnabled ?? true),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};
