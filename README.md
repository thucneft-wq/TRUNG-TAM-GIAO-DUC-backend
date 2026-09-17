# Digital Twin Backend

Express + TypeScript + PostgreSQL API for the Admin Web. The implementation uses
Route, Controller, Service, and Repository layers with Zod validation, JWT role-based
authentication, bcrypt password verification, parameterized `pg` queries, privacy
suppression for small analytics samples, CSV export, and audit logging.

Authorization model: the Web portal accepts exactly one configured Admin account from
`.env`. Counselor profiles and account records may remain in the database for operational
data synchronization, but the Web login endpoint does not accept Counselor credentials.
All protected Web features therefore run under the single Admin session.

Before using workload-normalized KPIs against an existing database, apply
`database/migrations/001_professional_kpi_inputs.sql` once.

Before enabling Student synchronization, apply
`database/migrations/002_student_school_level.sql` once. This migration only adds the
nullable `Students.school_level` field, its validation constraint, and an index; it does
not rename or remove any existing database object.

For the supplied local demo data, import files in this order:

1. `../new_database_psychological.sql`
2. `database/migrations/001_professional_kpi_inputs.sql`
3. `database/migrations/002_student_school_level.sql`
4. `database/seeds/000_fake_data_prerequisites.sql`
5. `../fake_data.sql`
6. `database/seeds/002_fake_data_school_levels.sql`

The prerequisite seed only creates the three addresses, two demo schools, and two demo
tests referenced by `fake_data.sql`. The final seed labels those demo students as THCS
or THPT so that the Admin Web can show both lists. These seed files are for a local demo
database only and must not be applied to a shared or production database.

```powershell
Copy-Item .env.example .env
# Replace all placeholders in .env.
npm.cmd install
npm.cmd run dev
```

Verification:

```powershell
npm.cmd run lint
npm.cmd run test
npm.cmd run build
```

Unit tests use mocked repositories and do not require PostgreSQL. A successful unit
test run is not a live database integration test. See `../docs/API_CONTRACT.md` and
`../docs/DEPLOYMENT.md` for the complete contract and deployment procedure.

## API health and Swagger

- Database health: `GET /api/health` (canonical) or `GET /health` (deployment-friendly alias).
- Swagger UI: `GET /api/docs`.
- OpenAPI 3.0 JSON: `GET /api/docs/openapi.json`.

In Swagger UI, call `POST /api/auth/login`, copy the returned JWT, click **Authorize**,
and paste the token into `bearerAuth` before testing protected routes.

## Google Sheet → PostgreSQL Student sync

The API receives normalized Student rows at
`POST /api/integrations/google-sheets/students`. Requests must include the
configured `GOOGLE_SHEETS_SYNC_SECRET` as a Bearer token. The legacy
`x-google-sync-secret` header remains accepted for compatibility.

Copy `scripts/google-sheets-student-sync.gs` into the Apps Script project attached to
the `Response đăng ký` spreadsheet. In Apps Script Project Settings, create these
Script Properties:

- `BACKEND_BASE_URL`: the public HTTPS backend URL ending in `/api`.
- `GOOGLE_SHEETS_SYNC_SECRET`: the same 32+ character secret as the backend `.env`.

Run `setupStudentStatusColumns()` once to add the `Trạng thái` dropdown to both Student
form-response tabs. Run `setupStudentManagementSheets()` once to create the Admin tabs
`students_THCS` and `students_THPT`. Run `installStudentSyncTriggers()` once to install
the form-submit and edit triggers, then run `syncAllStudents()` once for the initial
import. Google cannot call a backend that only runs at `localhost`; use a deployed HTTPS
URL or a temporary HTTPS tunnel for the integration test.

The script maps the two form-response tabs to `schoolLevel=THCS` and
`schoolLevel=THPT`. It sends only Student profile fields needed by the Admin list. It
does not send counseling issue answers, self-harm answers, or other clinical responses
through this endpoint.

For deletion, do not remove the Sheet row. Select `Ngừng theo dõi`; Apps Script sends
`status=INACTIVE`, the backend deactivates the Student and active counselor assignments
in one transaction, and the Student disappears from active Web lists. Selecting
`Đang hoạt động` reactivates the Student profile. This uses the existing
`Students.status` column and requires no additional database schema change.

## Google Sheet counselor approval

The counselor form-response tab is an intake queue, not the official counselor list.
New submissions are marked `Chờ duyệt`, receive no `TTV-*` ID, and are not created in
PostgreSQL. An Admin must change `Trạng thái` to `Đã duyệt`; Apps Script then assigns the
short counselor ID, synchronizes the active profile to PostgreSQL and upserts the
official `counselors` tab.

Changing an existing application to `Chờ duyệt`, `Từ chối`, or `Ngừng hoạt động`
soft-deactivates the corresponding database profile. The record remains available for
audit, while active Web lists omit it. Run `setupCounselorApprovalColumns()` once to add
the approval dropdown and `installCounselorSyncTriggers()` once to install its triggers.

When a counselor becomes `ACTIVE`, the backend immediately attempts to assign every
active Student that does not have a valid active counselor. Assignment uses the
least-loaded active counselor. When a counselor becomes `INACTIVE`, their active case
records are closed and the affected Students are reassigned to another active counselor;
if none is available, Admin continues to see the Student as unassigned. Counselor-scoped
Web access only includes Students with an active assignment to that counselor.
