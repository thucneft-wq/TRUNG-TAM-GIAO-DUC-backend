const json = (schema: Record<string, unknown>) => ({
  content: {
    'application/json': { schema },
  },
});

const response = (description: string, schema: Record<string, unknown>) => ({
  description,
  ...json(schema),
});

const errorResponse = (description: string) => ({
  description,
  ...json({ $ref: '#/components/schemas/ErrorResponse' }),
});

const bearerSecurity = [{ bearerAuth: [] }];
const syncSecurity = [{ googleSheetsBearer: [] }, { googleSheetsHeader: [] }];

const periodParameter = {
  name: 'period',
  in: 'query',
  required: false,
  description: 'Reporting period. Hyphenated values are also accepted.',
  schema: {
    type: 'string',
    enum: ['this_month', 'last_month', 'all_time'],
    default: 'this_month',
  },
};

const analyticsParameters = [
  periodParameter,
  {
    name: 'counselorId',
    in: 'query',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  },
  {
    name: 'testId',
    in: 'query',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  },
  {
    name: 'category',
    in: 'query',
    required: false,
    schema: { type: 'string', maxLength: 100 },
  },
];

const idParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Digital Twin Backend API',
    version: '0.1.0',
    description: [
      'API for the Digital Twin Psychological Counseling Centre Admin Web.',
      'Use POST /api/auth/login first, copy the returned token, then click Authorize and enter that token.',
      'The health route is available at both /api/health and /health.',
    ].join('\n\n'),
  },
  servers: [
    {
      url: '/',
      description: 'Current deployment',
    },
  ],
  tags: [
    { name: 'System', description: 'Service and database health' },
    { name: 'Authentication', description: 'Admin authentication' },
    { name: 'Students', description: 'Student management' },
    { name: 'Counselors', description: 'Counselor management and KPI results' },
    { name: 'Analytics', description: 'Dashboard, analytics, CSV exports, and audit logs' },
    { name: 'Integrations', description: 'Google Sheets synchronization webhooks' },
  ],
  paths: {
    '/': {
      get: {
        tags: ['System'],
        summary: 'Get backend information',
        operationId: 'getBackendInfo',
        responses: {
          '200': response('Backend is running.', { $ref: '#/components/schemas/BackendInfo' }),
        },
      },
    },
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Check service and database health',
        operationId: 'getHealthAlias',
        responses: {
          '200': response('Database is connected.', { $ref: '#/components/schemas/Health' }),
          '503': response('Database is unavailable.', { $ref: '#/components/schemas/Health' }),
        },
      },
    },
    '/api/health': {
      get: {
        tags: ['System'],
        summary: 'Check service and database health',
        operationId: 'getHealth',
        responses: {
          '200': response('Database is connected.', { $ref: '#/components/schemas/Health' }),
          '503': response('Database is unavailable.', { $ref: '#/components/schemas/Health' }),
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Log in as the configured administrator',
        operationId: 'loginAdmin',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginRequest' },
              example: {
                email: 'admin@example.com',
                password: 'your-admin-password',
              },
            },
          },
        },
        responses: {
          '200': response('Authentication succeeded.', { $ref: '#/components/schemas/LoginResponse' }),
          '400': errorResponse('Request validation failed.'),
          '401': errorResponse('Email or password is incorrect.'),
        },
      },
    },
    '/api/students': {
      get: {
        tags: ['Students'],
        summary: 'List students in the current access scope',
        operationId: 'listStudents',
        security: bearerSecurity,
        responses: {
          '200': response('Student collection.', {
            type: 'object',
            required: ['students'],
            properties: {
              students: { type: 'array', items: { $ref: '#/components/schemas/Student' } },
            },
          }),
          '401': errorResponse('Authentication is required.'),
          '403': errorResponse('The current role is not allowed.'),
        },
      },
      post: {
        tags: ['Students'],
        summary: 'Create a student',
        description: 'Requires WEB_CRUD_ENABLED=true on the backend.',
        operationId: 'createStudent',
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateStudent' },
              example: {
                firstName: 'An',
                lastName: 'Nguyen',
                phoneNumber: '0900000000',
                email: 'student@example.com',
                schoolLevel: 'THCS',
                status: 'ACTIVE',
              },
            },
          },
        },
        responses: {
          '201': response('Student created.', {
            type: 'object',
            properties: { student: { $ref: '#/components/schemas/Student' } },
          }),
          '400': errorResponse('Request validation failed.'),
          '401': errorResponse('Authentication is required.'),
          '403': errorResponse('The role or current plan does not allow this operation.'),
          '409': errorResponse('A unique value already exists.'),
        },
      },
    },
    '/api/students/{id}': {
      get: {
        tags: ['Students'],
        summary: 'Get a student by ID',
        operationId: 'getStudent',
        security: bearerSecurity,
        parameters: [idParameter],
        responses: {
          '200': response('Student details.', {
            type: 'object',
            properties: { student: { $ref: '#/components/schemas/Student' } },
          }),
          '400': errorResponse('The ID is not a UUID.'),
          '401': errorResponse('Authentication is required.'),
          '404': errorResponse('Student was not found.'),
        },
      },
      patch: {
        tags: ['Students'],
        summary: 'Update a student',
        description: 'Requires WEB_CRUD_ENABLED=true on the backend.',
        operationId: 'updateStudent',
        security: bearerSecurity,
        parameters: [idParameter],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateStudent' },
              example: { phoneNumber: '0911111111' },
            },
          },
        },
        responses: {
          '200': response('Student updated.', {
            type: 'object',
            properties: { student: { $ref: '#/components/schemas/Student' } },
          }),
          '400': errorResponse('Request validation failed.'),
          '401': errorResponse('Authentication is required.'),
          '403': errorResponse('The role or current plan does not allow this operation.'),
          '404': errorResponse('Student was not found.'),
        },
      },
      delete: {
        tags: ['Students'],
        summary: 'Soft-deactivate a student',
        description: 'Requires WEB_CRUD_ENABLED=true on the backend.',
        operationId: 'deactivateStudent',
        security: bearerSecurity,
        parameters: [idParameter],
        responses: {
          '204': { description: 'Student deactivated.' },
          '401': errorResponse('Authentication is required.'),
          '403': errorResponse('The role or current plan does not allow this operation.'),
          '404': errorResponse('Student was not found.'),
        },
      },
    },
    '/api/admin/dashboard': {
      get: {
        tags: ['Analytics'],
        summary: 'Get dashboard metrics',
        operationId: 'getDashboard',
        security: bearerSecurity,
        parameters: [periodParameter],
        responses: {
          '200': response('Dashboard metrics.', { type: 'object', additionalProperties: true }),
          '400': errorResponse('Invalid period.'),
          '401': errorResponse('Authentication is required.'),
          '403': errorResponse('Administrator role is required.'),
        },
      },
    },
    '/api/admin/counselors': {
      get: {
        tags: ['Counselors'],
        summary: 'List counselors and KPI results',
        operationId: 'listCounselors',
        security: bearerSecurity,
        parameters: [periodParameter],
        responses: {
          '200': response('Counselor collection.', {
            type: 'object',
            properties: {
              period: { type: 'string' },
              counselors: { type: 'array', items: { $ref: '#/components/schemas/Counselor' } },
            },
          }),
          '400': errorResponse('Invalid period.'),
          '401': errorResponse('Authentication is required.'),
          '403': errorResponse('Administrator role is required.'),
        },
      },
      post: {
        tags: ['Counselors'],
        summary: 'Create a counselor',
        description: 'Requires an administrator token and WEB_CRUD_ENABLED=true.',
        operationId: 'createCounselor',
        security: bearerSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CounselorInput' },
              example: {
                firstName: 'Binh',
                lastName: 'Tran',
                email: 'counselor@example.com',
                status: 'ACTIVE',
              },
            },
          },
        },
        responses: {
          '201': response('Counselor created.', {
            type: 'object',
            properties: { counselor: { $ref: '#/components/schemas/Counselor' } },
          }),
          '400': errorResponse('Request validation failed.'),
          '401': errorResponse('Authentication is required.'),
          '403': errorResponse('The role or current plan does not allow this operation.'),
          '409': errorResponse('A unique value already exists.'),
        },
      },
    },
    '/api/admin/counselors/{id}': {
      get: {
        tags: ['Counselors'],
        summary: 'Get counselor details and KPI results',
        operationId: 'getCounselor',
        security: bearerSecurity,
        parameters: [idParameter, periodParameter],
        responses: {
          '200': response('Counselor details.', {
            type: 'object',
            properties: {
              period: { type: 'string' },
              counselor: { $ref: '#/components/schemas/Counselor' },
            },
          }),
          '400': errorResponse('Invalid ID or period.'),
          '401': errorResponse('Authentication is required.'),
          '404': errorResponse('Counselor was not found.'),
        },
      },
      patch: {
        tags: ['Counselors'],
        summary: 'Update a counselor',
        description: 'Requires an administrator token and WEB_CRUD_ENABLED=true.',
        operationId: 'updateCounselor',
        security: bearerSecurity,
        parameters: [idParameter, periodParameter],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateCounselor' },
              example: { status: 'ON_LEAVE' },
            },
          },
        },
        responses: {
          '200': response('Counselor updated.', {
            type: 'object',
            properties: { counselor: { $ref: '#/components/schemas/Counselor' } },
          }),
          '400': errorResponse('Request validation failed.'),
          '401': errorResponse('Authentication is required.'),
          '403': errorResponse('The role or current plan does not allow this operation.'),
          '404': errorResponse('Counselor was not found.'),
        },
      },
      delete: {
        tags: ['Counselors'],
        summary: 'Soft-deactivate a counselor',
        description: 'Requires an administrator token and WEB_CRUD_ENABLED=true.',
        operationId: 'deactivateCounselor',
        security: bearerSecurity,
        parameters: [idParameter],
        responses: {
          '204': { description: 'Counselor deactivated.' },
          '401': errorResponse('Authentication is required.'),
          '403': errorResponse('The role or current plan does not allow this operation.'),
          '404': errorResponse('Counselor was not found.'),
        },
      },
    },
    '/api/admin/analytics/filters': {
      get: {
        tags: ['Analytics'],
        summary: 'Get analytics filter options',
        operationId: 'getAnalyticsFilters',
        security: bearerSecurity,
        responses: {
          '200': response('Available filters.', { $ref: '#/components/schemas/AnalyticsFilters' }),
          '401': errorResponse('Authentication is required.'),
          '403': errorResponse('Administrator role is required.'),
        },
      },
    },
    '/api/admin/analytics/student-trends': {
      get: {
        tags: ['Analytics'],
        summary: 'Get student trend analytics',
        operationId: 'getStudentTrends',
        security: bearerSecurity,
        parameters: analyticsParameters,
        responses: {
          '200': response('Student trend analytics.', { type: 'object', additionalProperties: true }),
          '400': errorResponse('Invalid analytics filters.'),
          '401': errorResponse('Authentication is required.'),
          '403': errorResponse('Administrator role is required.'),
        },
      },
    },
    '/api/admin/analytics/feedback': {
      get: {
        tags: ['Analytics'],
        summary: 'Get feedback analytics',
        operationId: 'getFeedbackAnalytics',
        security: bearerSecurity,
        parameters: analyticsParameters,
        responses: {
          '200': response('Feedback analytics.', { type: 'object', additionalProperties: true }),
          '400': errorResponse('Invalid analytics filters.'),
          '401': errorResponse('Authentication is required.'),
          '403': errorResponse('Administrator role is required.'),
        },
      },
    },
    '/api/admin/analytics/export': {
      get: {
        tags: ['Analytics'],
        summary: 'Export analytics as CSV',
        operationId: 'exportAnalytics',
        security: bearerSecurity,
        parameters: [
          ...analyticsParameters,
          {
            name: 'type',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['overview', 'student_trends', 'feedback'],
              default: 'overview',
            },
          },
        ],
        responses: {
          '200': {
            description: 'CSV export.',
            content: {
              'text/csv': { schema: { type: 'string' } },
            },
          },
          '400': errorResponse('Invalid export parameters.'),
          '401': errorResponse('Authentication is required.'),
          '403': errorResponse('Administrator role is required.'),
        },
      },
    },
    '/api/admin/audit-logs': {
      get: {
        tags: ['Analytics'],
        summary: 'List recent audit logs',
        operationId: 'listAuditLogs',
        security: bearerSecurity,
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
          },
        ],
        responses: {
          '200': response('Audit log collection.', {
            type: 'object',
            properties: {
              auditLogs: { type: 'array', items: { $ref: '#/components/schemas/AuditLog' } },
            },
          }),
          '401': errorResponse('Authentication is required.'),
          '403': errorResponse('Administrator role is required.'),
        },
      },
    },
    '/api/integrations/google-sheets/students': {
      post: {
        tags: ['Integrations'],
        summary: 'Create or update a student from Google Sheets',
        operationId: 'syncGoogleSheetsStudent',
        security: syncSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateStudent' },
            },
          },
        },
        responses: {
          '200': response('Existing student synchronized.', { $ref: '#/components/schemas/StudentSyncResult' }),
          '201': response('New student synchronized.', { $ref: '#/components/schemas/StudentSyncResult' }),
          '400': errorResponse('Request validation failed.'),
          '401': errorResponse('Synchronization secret is invalid.'),
          '503': errorResponse('Synchronization is not configured.'),
        },
      },
    },
    '/api/integrations/google-sheets/assignments': {
      post: {
        tags: ['Integrations'],
        summary: 'Synchronize the current Student–Counselor assignment from Google Sheets',
        operationId: 'syncGoogleSheetsAssignment',
        security: syncSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/GoogleSheetsAssignment' },
            },
          },
        },
        responses: {
          '200': response('Assignment synchronized.', { type: 'object', additionalProperties: true }),
          '201': response('New active assignment created.', { type: 'object', additionalProperties: true }),
          '400': errorResponse('Request validation failed.'),
          '401': errorResponse('Synchronization secret is invalid.'),
          '404': errorResponse('Student or counselor could not be matched.'),
          '503': errorResponse('Synchronization is not configured.'),
        },
      },
    },
    '/api/integrations/google-sheets/counselors': {
      post: {
        tags: ['Integrations'],
        summary: 'Create or update a counselor from Google Sheets',
        operationId: 'syncGoogleSheetsCounselor',
        security: syncSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/GoogleSheetsCounselor' },
            },
          },
        },
        responses: {
          '200': response('Existing counselor synchronized.', { $ref: '#/components/schemas/CounselorSyncResult' }),
          '201': response('New counselor synchronized.', { $ref: '#/components/schemas/CounselorSyncResult' }),
          '400': errorResponse('Request validation failed.'),
          '401': errorResponse('Synchronization secret is invalid.'),
          '503': errorResponse('Synchronization is not configured.'),
        },
      },
    },
    '/api/integrations/google-sheets/counselor-accounts': {
      post: {
        tags: ['Integrations'],
        summary: 'Create or update a counselor login account from Google Sheets',
        operationId: 'syncGoogleSheetsCounselorAccount',
        security: syncSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/GoogleSheetsCounselorAccount' },
            },
          },
        },
        responses: {
          '200': response('Existing account synchronized.', { type: 'object', additionalProperties: true }),
          '201': response('New account synchronized.', { type: 'object', additionalProperties: true }),
          '400': errorResponse('Request validation failed.'),
          '401': errorResponse('Synchronization secret is invalid.'),
          '503': errorResponse('Synchronization is not configured.'),
        },
      },
    },
    '/api/integrations/google-sheets/feedbacks': {
      post: {
        tags: ['Integrations'],
        summary: 'Create or update counseling feedback from Google Sheets',
        operationId: 'syncGoogleSheetsFeedback',
        security: syncSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/GoogleSheetsFeedback' },
            },
          },
        },
        responses: {
          '200': response('Existing feedback synchronized.', { $ref: '#/components/schemas/FeedbackSyncResponse' }),
          '201': response('New feedback synchronized.', { $ref: '#/components/schemas/FeedbackSyncResponse' }),
          '400': errorResponse('Request validation failed.'),
          '401': errorResponse('Synchronization secret is invalid.'),
          '404': errorResponse('The referenced booking or session was not found.'),
          '503': errorResponse('Synchronization is not configured.'),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT returned by POST /api/auth/login.',
      },
      googleSheetsBearer: {
        type: 'http',
        scheme: 'bearer',
        description: 'GOOGLE_SHEETS_SYNC_SECRET sent as a Bearer token.',
      },
      googleSheetsHeader: {
        type: 'apiKey',
        in: 'header',
        name: 'x-google-sync-secret',
        description: 'Legacy Google Sheets synchronization header.',
      },
    },
    schemas: {
      BackendInfo: {
        type: 'object',
        required: ['name', 'status', 'health'],
        properties: {
          name: { type: 'string', example: 'Digital Twin Backend' },
          status: { type: 'string', example: 'running' },
          health: { type: 'string', example: '/api/health' },
          frontend: { type: 'string', example: 'http://localhost:3000' },
        },
      },
      Health: {
        type: 'object',
        required: ['status', 'database'],
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded'] },
          database: { type: 'string', enum: ['connected', 'unavailable'] },
        },
      },
      ErrorResponse: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', example: 'VALIDATION_ERROR' },
              message: { type: 'string' },
              issues: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
              details: {},
            },
          },
        },
      },
      LoginRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', format: 'password', minLength: 6, maxLength: 200 },
        },
      },
      LoginResponse: {
        type: 'object',
        required: ['token', 'user'],
        properties: {
          token: { type: 'string' },
          user: {
            type: 'object',
            required: ['id', 'name', 'email', 'role'],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              email: { type: 'string', format: 'email' },
              role: { type: 'string', enum: ['admin', 'counselor'] },
            },
          },
        },
      },
      CreateStudent: {
        type: 'object',
        additionalProperties: false,
        required: ['firstName', 'lastName', 'phoneNumber'],
        properties: {
          externalStudentId: { type: 'string', nullable: true, maxLength: 50, example: 'HS-01' },
          firstName: { type: 'string', minLength: 1, maxLength: 100 },
          lastName: { type: 'string', minLength: 1, maxLength: 100 },
          gender: { type: 'string', nullable: true, maxLength: 20 },
          phoneNumber: { type: 'string', minLength: 1, maxLength: 20 },
          email: { type: 'string', format: 'email', nullable: true, maxLength: 225 },
          parentPhoneNumber: { type: 'string', nullable: true, maxLength: 20 },
          parentEmail: { type: 'string', format: 'email', nullable: true, maxLength: 225 },
          dateOfBirth: { type: 'string', format: 'date', nullable: true },
          status: { type: 'string', enum: ['ACTIVE', 'COMPLETED', 'INACTIVE'], default: 'ACTIVE' },
          schoolLevel: { type: 'string', enum: ['THCS', 'THPT'], nullable: true },
          schoolName: { type: 'string', nullable: true, maxLength: 225 },
          schoolId: { type: 'string', format: 'uuid', nullable: true },
          addressId: { type: 'string', format: 'uuid', nullable: true },
          counselorId: { type: 'string', format: 'uuid', nullable: true },
        },
      },
      UpdateStudent: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          externalStudentId: { type: 'string', nullable: true, maxLength: 50, example: 'HS-01' },
          firstName: { type: 'string', minLength: 1, maxLength: 100 },
          lastName: { type: 'string', minLength: 1, maxLength: 100 },
          gender: { type: 'string', nullable: true, maxLength: 20 },
          phoneNumber: { type: 'string', minLength: 1, maxLength: 20 },
          email: { type: 'string', format: 'email', nullable: true, maxLength: 225 },
          parentPhoneNumber: { type: 'string', nullable: true, maxLength: 20 },
          parentEmail: { type: 'string', format: 'email', nullable: true, maxLength: 225 },
          dateOfBirth: { type: 'string', format: 'date', nullable: true },
          status: { type: 'string', enum: ['ACTIVE', 'COMPLETED', 'INACTIVE'] },
          schoolLevel: { type: 'string', enum: ['THCS', 'THPT'], nullable: true },
          schoolName: { type: 'string', nullable: true, maxLength: 225 },
          schoolId: { type: 'string', format: 'uuid', nullable: true },
          addressId: { type: 'string', format: 'uuid', nullable: true },
        },
      },
      Student: {
        allOf: [
          { $ref: '#/components/schemas/CreateStudent' },
          {
            type: 'object',
            required: ['id', 'externalId', 'name', 'assignedCounselorId', 'assignedCounselorExternalId', 'assignedCounselorName', 'assignmentStatus', 'assignmentEndedAt', 'createdAt', 'updatedAt'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              externalId: { type: 'string', nullable: true, example: 'HS-01' },
              name: { type: 'string' },
              assignedCounselorId: { type: 'string', format: 'uuid', nullable: true },
              assignedCounselorExternalId: { type: 'string', nullable: true, example: 'TTV-01' },
              assignedCounselorName: { type: 'string', nullable: true },
              assignmentStatus: { type: 'string', nullable: true },
              assignmentEndedAt: { type: 'string', format: 'date-time', nullable: true },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time', nullable: true },
            },
          },
        ],
      },
      CounselorInput: {
        type: 'object',
        additionalProperties: false,
        required: ['firstName', 'lastName'],
        properties: {
          firstName: { type: 'string', minLength: 1, maxLength: 100 },
          lastName: { type: 'string', minLength: 1, maxLength: 100 },
          gender: { type: 'string', nullable: true, maxLength: 20 },
          phoneNumber: { type: 'string', nullable: true, maxLength: 20 },
          email: { type: 'string', format: 'email', nullable: true, maxLength: 225 },
          dateOfBirth: { type: 'string', format: 'date', nullable: true },
          role: { type: 'string', nullable: true, maxLength: 30 },
          specialization: { type: 'string', nullable: true, maxLength: 225 },
          status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'ON_LEAVE'], default: 'ACTIVE' },
        },
      },
      UpdateCounselor: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          firstName: { type: 'string', minLength: 1, maxLength: 100 },
          lastName: { type: 'string', minLength: 1, maxLength: 100 },
          gender: { type: 'string', nullable: true, maxLength: 20 },
          phoneNumber: { type: 'string', nullable: true, maxLength: 20 },
          email: { type: 'string', format: 'email', nullable: true, maxLength: 225 },
          dateOfBirth: { type: 'string', format: 'date', nullable: true },
          role: { type: 'string', nullable: true, maxLength: 30 },
          specialization: { type: 'string', nullable: true, maxLength: 225 },
          status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'ON_LEAVE'] },
        },
      },
      Counselor: {
        type: 'object',
        additionalProperties: true,
        required: ['id', 'externalId', 'firstName', 'lastName', 'name', 'status'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          externalId: { type: 'string', nullable: true, example: 'TTV-01' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email', nullable: true },
          status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'ON_LEAVE'] },
          kpis: { type: 'array', items: { type: 'object', additionalProperties: true } },
          overallScore: { type: 'number' },
          overallStatus: { type: 'string', enum: ['Pass', 'Not Pass', 'Insufficient Data'] },
        },
      },
      AnalyticsFilters: {
        type: 'object',
        required: ['counselors', 'tests', 'categories'],
        properties: {
          counselors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                name: { type: 'string' },
              },
            },
          },
          tests: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                name: { type: 'string' },
                type: { type: 'string', nullable: true },
              },
            },
          },
          categories: { type: 'array', items: { type: 'string' } },
        },
      },
      AuditLog: {
        type: 'object',
        properties: {
          audit_log_id: { type: 'string', format: 'uuid' },
          actor_role: { type: 'string', nullable: true },
          action: { type: 'string', nullable: true },
          entity_type: { type: 'string', nullable: true },
          entity_id: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      GoogleSheetsCounselor: {
        allOf: [
          { $ref: '#/components/schemas/CounselorInput' },
          {
            type: 'object',
            properties: {
              counselorId: { type: 'string', format: 'uuid' },
              externalCounselorId: { type: 'string', maxLength: 50, example: 'TTV-01' },
            },
          },
        ],
      },
      GoogleSheetsCounselorAccount: {
        type: 'object',
        additionalProperties: false,
        required: ['email'],
        properties: {
          userId: { type: 'string', format: 'uuid' },
          counselorId: { type: 'string', format: 'uuid' },
          counselorEmail: { type: 'string', format: 'email' },
          email: { type: 'string', format: 'email' },
          password: { type: 'string', format: 'password', minLength: 8, maxLength: 100 },
          passwordHash: { type: 'string', writeOnly: true },
          status: {
            type: 'string',
            enum: ['PENDING_VERIFICATION', 'ACTIVE', 'LOCKED', 'SUSPENDED', 'DISABLED'],
            default: 'ACTIVE',
          },
        },
      },
      GoogleSheetsFeedback: {
        type: 'object',
        additionalProperties: false,
        required: ['rating'],
        properties: {
          feedbackId: { type: 'string', format: 'uuid' },
          sessionId: { type: 'string', format: 'uuid' },
          bookingId: { type: 'string', format: 'uuid' },
          externalSessionId: { type: 'string', maxLength: 50, example: 'SES-01' },
          externalBookingId: { type: 'string', maxLength: 50, example: 'BKG-01' },
          externalStudentId: { type: 'string', maxLength: 50, example: 'HS-01' },
          externalCounselorId: { type: 'string', maxLength: 50, example: 'TTV-01' },
          bookingStartTime: { type: 'string', format: 'date-time' },
          bookingEndTime: { type: 'string', format: 'date-time' },
          bookingStatus: { type: 'string', maxLength: 30 },
          sessionStartedAt: { type: 'string', format: 'date-time' },
          sessionEndedAt: { type: 'string', format: 'date-time' },
          sessionStatus: { type: 'string', maxLength: 30 },
          rating: { type: 'integer', minimum: 1, maximum: 5 },
          comment: { type: 'string', maxLength: 5000 },
          category: { type: 'string', maxLength: 100 },
          createdAt: { type: 'string', format: 'date-time' },
        },
        description: 'Provide an internal UUID or short Sheet ID. A short booking ID also requires Student/Counselor short IDs and booking times. Repeated syncs update the feedback for that session.',
      },
      GoogleSheetsAssignment: {
        type: 'object',
        additionalProperties: false,
        required: ['status'],
        properties: {
          studentId: { type: 'string', format: 'uuid' },
          externalStudentId: { type: 'string', maxLength: 50, example: 'HS-01' },
          studentEmail: { type: 'string', format: 'email' },
          studentPhoneNumber: { type: 'string', maxLength: 20 },
          counselorId: { type: 'string', format: 'uuid' },
          externalCounselorId: { type: 'string', maxLength: 50, example: 'TTV-01' },
          counselorEmail: { type: 'string', format: 'email' },
          counselorPhoneNumber: { type: 'string', maxLength: 20 },
          status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
          assignedAt: { type: 'string', format: 'date-time' },
          endedAt: { type: 'string', format: 'date-time' },
          caseWeight: { type: 'number', exclusiveMinimum: 0, maximum: 10 },
        },
        description: 'Identify both records by the short Sheet IDs (HS-01/TTV-01), UUIDs, or contact fields. An active sync replaces any previous active counselor for the student.',
      },
      FeedbackSyncResponse: {
        type: 'object',
        required: ['feedback'],
        properties: {
          feedback: {
            type: 'object',
            required: [
              'feedbackId',
              'sessionId',
              'bookingId',
              'studentId',
              'counselorId',
              'rating',
              'createdAt',
              'created',
            ],
            properties: {
              feedbackId: { type: 'string', format: 'uuid' },
              sessionId: { type: 'string', format: 'uuid' },
              bookingId: { type: 'string', format: 'uuid' },
              studentId: { type: 'string', format: 'uuid' },
              counselorId: { type: 'string', format: 'uuid' },
              rating: { type: 'integer', minimum: 1, maximum: 5 },
              category: { type: 'string', nullable: true },
              createdAt: { type: 'string', format: 'date-time' },
              created: { type: 'boolean' },
            },
          },
        },
      },
      StudentSyncResult: {
        type: 'object',
        required: ['student', 'created'],
        properties: {
          student: { $ref: '#/components/schemas/Student' },
          created: { type: 'boolean' },
        },
      },
      CounselorSyncResult: {
        type: 'object',
        required: ['counselor', 'created'],
        properties: {
          counselor: { $ref: '#/components/schemas/Counselor' },
          created: { type: 'boolean' },
        },
      },
    },
  },
} as const;
