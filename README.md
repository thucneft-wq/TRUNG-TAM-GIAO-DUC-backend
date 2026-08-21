# Digital Twin Backend

Express + TypeScript + PostgreSQL API for the Admin Web. The implementation uses
Route, Controller, Service, and Repository layers with Zod validation, JWT role-based
authentication, bcrypt password verification, parameterized `pg` queries, privacy
suppression for small analytics samples, CSV export, and audit logging.

Authorization model: `admin` is the highest role and owns Admin/analytics features;
`counselor` can only perform scoped Student CRUD. Counselor-created Students are linked
automatically through the assignment tables, and DELETE is a soft deactivation.
Admin credentials come from `.env`. Counselor login accounts come from `Users`,
`User_Profiles`, `User_Roles`, and `Roles`, so Google Sheet account changes take effect
without storing Counselor credentials in Backend configuration.

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
