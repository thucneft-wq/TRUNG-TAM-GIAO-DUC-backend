import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import { createApp, type AppDependencies } from '../src/application.js';
import type { CounselorDto } from '../src/types/counselor.js';
import type { StudentDto } from '../src/types/student.js';

const JWT_SECRET = 'test-only-jwt-secret-with-at-least-32-characters';
const SYNC_SECRET = 'test-google-sheets-secret-with-32-characters';
const COUNSELOR_ID = '10000000-0000-4000-8000-000000000001';
const STUDENT_ID = '20000000-0000-4000-8000-000000000001';
const token = jwt.sign(
  { role: 'admin' },
  JWT_SECRET,
  { subject: 'admin', issuer: 'digital-twin-backend', expiresIn: '1h' },
);
const counselorToken = jwt.sign(
  { role: 'counselor' },
  JWT_SECRET,
  { subject: COUNSELOR_ID, issuer: 'digital-twin-backend', expiresIn: '1h' },
);

const counselorFixture = {
  id: COUNSELOR_ID,
  firstName: 'Dev',
  lastName: 'Counselor',
  name: 'Dev Counselor',
  status: 'ACTIVE',
  kpis: [],
  passedKpis: 0,
  evaluableKpis: 0,
  failedKpis: 0,
  insufficientDataKpis: 5,
  totalKpis: 5,
  overallStatus: 'Not Pass',
} as unknown as CounselorDto;

const studentFixture: StudentDto = {
  id: STUDENT_ID,
  externalId: 'HS-01',
  firstName: 'Dev',
  lastName: 'Student',
  name: 'Dev Student',
  gender: 'UNSPECIFIED',
  phoneNumber: '000-100-0001',
  email: 'student@example.invalid',
  parentPhoneNumber: '0900000001',
  parentEmail: 'parent@example.invalid',
  dateOfBirth: '2010-01-01',
  status: 'ACTIVE',
  schoolLevel: 'THCS',
  schoolName: 'Trường THCS Mẫu',
  schoolId: null,
  addressId: null,
  assignedCounselorId: COUNSELOR_ID,
  assignedCounselorExternalId: 'TTV-01',
  assignedCounselorName: 'Dev Counselor',
  assignmentStatus: 'ACTIVE',
  assignmentEndedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: null,
};

const createDependencies = (): AppDependencies => ({
  authService: {
    login: async () => ({
      token: 'signed-token',
      user: {
        id: 'admin',
        name: 'Admin Supervisor',
        email: 'admin@example.invalid',
        role: 'admin',
      },
    }),
  },
  counselorService: {
    list: async () => [counselorFixture],
    getById: async () => counselorFixture,
    create: async () => counselorFixture,
    update: async () => counselorFixture,
    deactivate: async () => undefined,
    syncFromGoogleSheets: async () => ({ counselor: counselorFixture, created: true }),
    reconcileFromGoogleSheets: async () => ({
      deactivatedCounselors: 0,
      closedAssignments: 0,
    }),
  },
  counselorAccountService: {
    syncFromGoogleSheets: async (input) => ({
      userId: '30000000-0000-4000-8000-000000000001',
      counselorId: COUNSELOR_ID,
      email: input.email,
      status: input.status,
      created: true,
    }),
  },
  feedbackService: {
    syncFromGoogleSheets: async (input) => ({
      feedbackId: '40000000-0000-4000-8000-000000000001',
      sessionId: input.sessionId ?? '50000000-0000-4000-8000-000000000001',
      bookingId: input.bookingId ?? '60000000-0000-4000-8000-000000000001',
      studentId: STUDENT_ID,
      counselorId: COUNSELOR_ID,
      rating: input.rating,
      category: input.category ?? 'positive',
      createdAt: '2026-09-16T00:00:00.000Z',
      created: true,
    }),
  },
  studentService: {
    list: async () => [studentFixture],
    getById: async () => studentFixture,
    create: async () => studentFixture,
    update: async () => studentFixture,
    deactivate: async () => undefined,
    syncFromGoogleSheets: async () => ({ student: studentFixture, created: true }),
    syncAssignmentFromGoogleSheets: async () => ({
      assignmentId: null,
      studentId: STUDENT_ID,
      counselorId: COUNSELOR_ID,
      status: 'INACTIVE',
      created: false,
    }),
    reconcileFromGoogleSheets: async () => ({
      deactivatedStudents: 0,
      closedAssignments: 0,
    }),
  },
  dashboardService: {
    get: async () => ({ activeCounselors: 1 }),
  },
  analyticsService: {
    getFilterOptions: async () => ({ counselors: [], tests: [], categories: [] }),
    getStudentTrends: async () => ({ timeline: [] }),
    getFeedback: async () => ({ timeline: [] }),
    exportCsv: async () => '\uFEFFmetric,value\r\n',
    recordAudit: async () => undefined,
    listAuditLogs: async () => [],
  },
  checkDatabase: async () => undefined,
  jwtSecret: JWT_SECRET,
  corsOrigins: ['http://localhost:3000'],
  googleSheetsSyncSecret: SYNC_SECRET,
});

const request = async (
  dependencies: AppDependencies,
  path: string,
  init: RequestInit = {},
): Promise<Response> => {
  const server = createApp(dependencies).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;

  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, init);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
};

const authHeaders = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};

test('root route describes the running backend instead of returning 404', async () => {
  const response = await request(createDependencies(), '/');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    name: 'Digital Twin Backend',
    status: 'running',
    health: '/api/health',
    frontend: 'http://localhost:3000',
  });
});

test('login validates input before calling the auth service', async () => {
  const response = await request(createDependencies(), '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email', password: '123456' }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
});

test('malformed JSON returns a client error instead of a server error', async () => {
  const response = await request(createDependencies(), '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid-json}',
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INVALID_JSON');
});

test('admin routes reject unauthenticated requests', async () => {
  const response = await request(createDependencies(), '/api/admin/counselors');
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'AUTHENTICATION_REQUIRED');
});

test('counselor cannot access admin analytics', async () => {
  const response = await request(createDependencies(), '/api/admin/analytics/filters', {
    headers: { Authorization: `Bearer ${counselorToken}` },
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'ROLE_FORBIDDEN');
});

test('counselor cannot mutate counselors', async () => {
  const response = await request(createDependencies(), '/api/admin/counselors', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${counselorToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      firstName: 'Read-only',
      lastName: 'Counselor',
      email: 'readonly@example.invalid',
    }),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'ROLE_FORBIDDEN');
});

test('only admin can read audit logs', async () => {
  const counselorResponse = await request(createDependencies(), '/api/admin/audit-logs', {
    headers: { Authorization: `Bearer ${counselorToken}` },
  });
  assert.equal(counselorResponse.status, 403);

  const adminResponse = await request(createDependencies(), '/api/admin/audit-logs', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(adminResponse.status, 200);
  assert.deepEqual(await adminResponse.json(), { auditLogs: [] });
});

test('counselor can list only the students provided by the scoped service', async () => {
  let receivedCounselorId: string | null = null;
  const dependencies = createDependencies();
  dependencies.studentService.list = async (scope) => {
    receivedCounselorId = scope.counselorId;
    return [studentFixture];
  };
  const response = await request(dependencies, '/api/students', {
    headers: { Authorization: `Bearer ${counselorToken}` },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).students[0].id, STUDENT_ID);
  assert.equal(receivedCounselorId, COUNSELOR_ID);
});

test('counselor can create, update and soft-delete a student', async () => {
  const dependencies = createDependencies();
  let created = false;
  let updated = false;
  let deactivated = false;
  dependencies.studentService.create = async () => {
    created = true;
    return studentFixture;
  };
  dependencies.studentService.update = async () => {
    updated = true;
    return studentFixture;
  };
  dependencies.studentService.deactivate = async () => {
    deactivated = true;
  };
  const headers = {
    Authorization: `Bearer ${counselorToken}`,
    'Content-Type': 'application/json',
  };

  const createResponse = await request(dependencies, '/api/students', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      firstName: 'Dev',
      lastName: 'Student',
      phoneNumber: '000-100-0001',
    }),
  });
  const updateResponse = await request(dependencies, `/api/students/${STUDENT_ID}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ phoneNumber: '000-100-0002' }),
  });
  const deleteResponse = await request(dependencies, `/api/students/${STUDENT_ID}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${counselorToken}` },
  });

  assert.equal(createResponse.status, 201);
  assert.equal(updateResponse.status, 200);
  assert.equal(deleteResponse.status, 204);
  assert.equal(created, true);
  assert.equal(updated, true);
  assert.equal(deactivated, true);
});

test('Google Sheets webhook requires its secret and synchronizes Student data', async () => {
  let synchronized = false;
  let synchronizedLevel = '';
  let synchronizedSchool = '';
  const dependencies = createDependencies();
  dependencies.studentService.syncFromGoogleSheets = async (input) => {
    synchronized = true;
    synchronizedLevel = input.schoolLevel ?? '';
    synchronizedSchool = input.schoolName ?? '';
    return { student: studentFixture, created: true };
  };
  const body = JSON.stringify({
    firstName: 'Sheet',
    lastName: 'Student',
    phoneNumber: '000-200-0001',
    schoolLevel: 'THCS',
    schoolName: 'Trường THCS Mẫu',
  });
  const unauthorized = await request(
    dependencies,
    '/api/integrations/google-sheets/students',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
  );
  assert.equal(unauthorized.status, 401);

  const authorized = await request(
    dependencies,
    '/api/integrations/google-sheets/students',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SYNC_SECRET}` },
      body,
    },
  );
  assert.equal(authorized.status, 201);
  assert.equal(synchronized, true);
  assert.equal(synchronizedLevel, 'THCS');
  assert.equal(synchronizedSchool, 'Trường THCS Mẫu');
});

test('Sheet mirror route stays behind Admin authentication', async () => {
  const dependencies = createDependencies();
  dependencies.sheetMirrorService = {
    readTable: async () => ({
      ok: true,
      table: 'counselors',
      lastSyncAt: null,
      total: 1,
      page: 1,
      pageSize: 100,
      data: [{ counselor_id: 'TTV-01', status: 'active' }],
    }),
  };

  const unauthorized = await request(dependencies, '/api/admin/sheet-mirror/counselors');
  assert.equal(unauthorized.status, 401);

  const authorized = await request(dependencies, '/api/admin/sheet-mirror/counselors', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(authorized.status, 200);
  const payload = await authorized.json();
  assert.equal(payload.total, 1);
  assert.equal(payload.data[0].counselor_id, 'TTV-01');
});

test('Google Sheets reconciliation soft-deactivates students missing from management tabs', async () => {
  let receivedIds: string[] = [];
  const dependencies = createDependencies();
  dependencies.studentService.reconcileFromGoogleSheets = async (activeExternalStudentIds) => {
    receivedIds = activeExternalStudentIds;
    return { deactivatedStudents: 3, closedAssignments: 2 };
  };
  const body = JSON.stringify({ activeExternalStudentIds: ['HS-07'] });

  const unauthorized = await request(
    dependencies,
    '/api/integrations/google-sheets/students/reconcile',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
  );
  assert.equal(unauthorized.status, 401);

  const authorized = await request(
    dependencies,
    '/api/integrations/google-sheets/students/reconcile',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SYNC_SECRET}` },
      body,
    },
  );
  assert.equal(authorized.status, 200);
  assert.deepEqual(receivedIds, ['HS-07']);
  assert.deepEqual(await authorized.json(), {
    deactivatedStudents: 3,
    closedAssignments: 2,
  });
});

test('health check is available at both the canonical path and its root alias', async () => {
  const canonicalResponse = await request(createDependencies(), '/api/health');
  assert.equal(canonicalResponse.status, 200);
  assert.deepEqual(await canonicalResponse.json(), { status: 'ok', database: 'connected' });

  const aliasResponse = await request(createDependencies(), '/health');
  assert.equal(aliasResponse.status, 200);
  assert.deepEqual(await aliasResponse.json(), { status: 'ok', database: 'connected' });
});

test('Swagger UI and its OpenAPI document describe the live API routes', async () => {
  const documentResponse = await request(createDependencies(), '/api/docs/openapi.json');
  assert.equal(documentResponse.status, 200);
  const document = await documentResponse.json();
  assert.equal(document.openapi, '3.0.3');
  assert.ok(document.paths['/api/health']);
  assert.ok(document.paths['/api/auth/login']);
  assert.ok(document.paths['/api/admin/counselors']);
  assert.ok(document.paths['/api/students']);
  assert.ok(document.paths['/api/integrations/google-sheets/feedbacks']);

  const uiResponse = await request(createDependencies(), '/api/docs');
  assert.equal(uiResponse.status, 200);
  assert.match(uiResponse.headers.get('content-type') ?? '', /^text\/html/);
  assert.match(await uiResponse.text(), /SwaggerUIBundle/);
});

test('Google Sheets webhook synchronizes Counselor profiles', async () => {
  let synchronized = false;
  const dependencies = createDependencies();
  dependencies.counselorService.syncFromGoogleSheets = async () => {
    synchronized = true;
    return { counselor: counselorFixture, created: true };
  };
  const response = await request(
    dependencies,
    '/api/integrations/google-sheets/counselors',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-google-sync-secret': SYNC_SECRET },
      body: JSON.stringify({
        counselorId: COUNSELOR_ID,
        firstName: 'Dev',
        lastName: 'Counselor',
        email: 'counselor@example.invalid',
        status: 'ACTIVE',
      }),
    },
  );
  assert.equal(response.status, 201);
  assert.equal(synchronized, true);
});

test('Google Sheets reconciliation deactivates counselors missing from the official tab', async () => {
  let receivedIds: string[] = ['unexpected'];
  const dependencies = createDependencies();
  dependencies.counselorService.reconcileFromGoogleSheets = async (activeIds) => {
    receivedIds = activeIds;
    return { deactivatedCounselors: 3, closedAssignments: 2 };
  };
  const body = JSON.stringify({ activeExternalCounselorIds: [] });

  const unauthorized = await request(
    dependencies,
    '/api/integrations/google-sheets/counselors/reconcile',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
  );
  assert.equal(unauthorized.status, 401);

  const authorized = await request(
    dependencies,
    '/api/integrations/google-sheets/counselors/reconcile',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SYNC_SECRET}` },
      body,
    },
  );
  assert.equal(authorized.status, 200);
  assert.deepEqual(receivedIds, []);
  assert.deepEqual(await authorized.json(), {
    deactivatedCounselors: 3,
    closedAssignments: 2,
  });
});

test('Google Sheets webhook synchronizes Counselor login accounts without echoing passwords', async () => {
  let receivedPassword = '';
  const dependencies = createDependencies();
  dependencies.counselorAccountService.syncFromGoogleSheets = async (input) => {
    receivedPassword = input.password ?? '';
    return {
      userId: '30000000-0000-4000-8000-000000000001',
      counselorId: COUNSELOR_ID,
      email: input.email,
      status: input.status,
      created: true,
    };
  };
  const response = await request(
    dependencies,
    '/api/integrations/google-sheets/counselor-accounts',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-google-sync-secret': SYNC_SECRET },
      body: JSON.stringify({
        counselorId: COUNSELOR_ID,
        email: 'counselor@example.invalid',
        password: 'Temporary@123',
        status: 'ACTIVE',
      }),
    },
  );
  assert.equal(response.status, 201);
  assert.equal(receivedPassword, 'Temporary@123');
  const payload = await response.json();
  assert.equal('password' in payload.account, false);
  assert.equal('passwordHash' in payload.account, false);
});

test('Google Sheets webhook synchronizes feedback and requires a session reference', async () => {
  let receivedRating = 0;
  const dependencies = createDependencies();
  dependencies.feedbackService.syncFromGoogleSheets = async (input) => {
    receivedRating = input.rating;
    return {
      feedbackId: '40000000-0000-4000-8000-000000000001',
      sessionId: '50000000-0000-4000-8000-000000000001',
      bookingId: input.bookingId ?? '60000000-0000-4000-8000-000000000001',
      studentId: STUDENT_ID,
      counselorId: COUNSELOR_ID,
      rating: input.rating,
      category: 'positive',
      createdAt: '2026-09-16T00:00:00.000Z',
      created: true,
    };
  };

  const invalid = await request(
    dependencies,
    '/api/integrations/google-sheets/feedbacks',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SYNC_SECRET}`,
      },
      body: JSON.stringify({ rating: 5 }),
    },
  );
  assert.equal(invalid.status, 400);

  const response = await request(
    dependencies,
    '/api/integrations/google-sheets/feedbacks',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SYNC_SECRET}`,
      },
      body: JSON.stringify({
        bookingId: '60000000-0000-4000-8000-000000000001',
        rating: 5,
        comment: 'Hữu ích',
      }),
    },
  );
  assert.equal(response.status, 201);
  assert.equal(receivedRating, 5);
  const payload = await response.json();
  assert.equal(payload.feedback.category, 'positive');
  assert.equal('comment' in payload.feedback, false);
});

test('analytics export returns a CSV attachment and records an audit event', async () => {
  let auditAction = '';
  const dependencies = createDependencies();
  dependencies.analyticsService.recordAudit = async (_actor, action) => {
    auditAction = action;
  };

  const response = await request(
    dependencies,
    '/api/admin/analytics/export?type=overview&period=this_month',
    { headers: { Authorization: `Bearer ${token}` } },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/csv/);
  assert.match(response.headers.get('content-disposition') ?? '', /overview-this_month\.csv/);
  assert.match(await response.text(), /metric,value/);
  assert.equal(auditAction, 'EXPORT_ANALYTICS');
});

test('create counselor rejects unknown fields', async () => {
  const response = await request(createDependencies(), '/api/admin/counselors', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      firstName: 'Dev',
      lastName: 'Counselor',
      email: 'dev@example.invalid',
      status: 'ACTIVE',
      studentCaseNotes: 'must never be accepted',
    }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
});

test('read counselor returns the service result', async () => {
  const response = await request(
    createDependencies(),
    `/api/admin/counselors/${COUNSELOR_ID}?period=this_month`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).counselor.id, COUNSELOR_ID);
});

test('update counselor forwards only validated fields', async () => {
  let receivedName = '';
  const dependencies = createDependencies();
  dependencies.counselorService.update = async (_id, input) => {
    receivedName = input.firstName ?? '';
    return counselorFixture;
  };

  const response = await request(
    dependencies,
    `/api/admin/counselors/${COUNSELOR_ID}`,
    {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ firstName: 'Updated' }),
    },
  );
  assert.equal(response.status, 200);
  assert.equal(receivedName, 'Updated');
});

test('soft delete endpoint returns 204 and calls deactivate', async () => {
  let deactivatedId = '';
  const dependencies = createDependencies();
  dependencies.counselorService.deactivate = async (id) => {
    deactivatedId = id;
  };

  const response = await request(
    dependencies,
    `/api/admin/counselors/${COUNSELOR_ID}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  );
  assert.equal(response.status, 204);
  assert.equal(deactivatedId, COUNSELOR_ID);
});
