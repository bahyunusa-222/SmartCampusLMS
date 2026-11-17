# Backend LMS API additions

The server runs additive, idempotent schema migrations before create-only
`sequelize.sync()`. To apply the migration separately during deployment, run
`npm run migrate` from this directory. It adds optional legacy-table columns
and records the applied migration in `SchemaMigrations`; it does not drop or
alter existing data. Do not use `sync({ alter: true })`.

Database connections use a configurable per-process pool (`DB_POOL_MAX`,
`DB_POOL_MIN`, `DB_POOL_ACQUIRE`, `DB_POOL_IDLE`, and `DB_CONNECT_TIMEOUT`).
Set `DB_POOL_MAX` based
on the database's available connection limit and the number of backend
instances; the total possible connections are approximately the pool maximum
multiplied by the number of instances. Assessment starts lock the enrolling
student's course enrollment while checking and creating attempts, preventing
simultaneous starts from exceeding the configured attempt limit without
serializing starts by every other student.

For local development, create a PostgreSQL database (for example, `smartcampus`)
in pgAdmin, then set `DB_HOST=localhost`, `DB_PORT=5432`, `DB_NAME`,
`DB_USER`, and `DB_PASSWORD` in `backend/.env`. Leave `DATABASE_URL` empty and
set `DB_SSL=false` for local PostgreSQL. The backend applies its migrations and
creates missing tables when it starts; it does not create the PostgreSQL
database itself.

For deployment, set `DB_DIALECT=postgres`, `DATABASE_URL` to the PostgreSQL
connection URI from Supabase's **Transaction pooler** settings, and
`DB_SSL=true` in the hosting provider's environment settings. Transaction mode
uses port `6543` and is recommended for serverless deployments such as Vercel;
the session pooler's port `5432` has a low cap on client connections and can
return `max clients reached in session mode` when multiple backend instances
connect. `DATABASE_URL` takes precedence
over the individual `DB_HOST`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` settings, so the
same code can use local PostgreSQL in development and Supabase in deployment.
Keep the connection pool small for serverless deployments; if the host cannot
connect directly to the database, use Supabase's transaction pooler URI.
Set `DB_POOL_MAX=2` on Vercel and keep the total pool size within the
database provider's limit; each serverless instance has its own pool.
At least two connections are required because startup holds one connection for
the PostgreSQL advisory migration lock while migrations use another. If the
database connection budget cannot support two connections per active instance,
reduce Vercel function concurrency or run migrations as a separate deployment
step; do not lower this pool to one.
PostgreSQL is selected automatically when `DATABASE_URL` is set and
`DB_DIALECT` is omitted. SSL certificate verification is enabled whenever SSL
is enabled; only disable SSL for local development, never to work around an
untrusted production certificate. If the provider uses a private or self-signed
CA, download its CA certificate from the provider's database settings and set
`DB_SSL_CA_FILE` to that certificate's path. The certificate is added to the
trusted CA set without disabling certificate or hostname verification.

On Vercel, new uploads use the private Cloudflare R2 bucket when
`FILE_STORAGE_PROVIDER=r2`. Set backend-only `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME`; optionally
override `R2_ENDPOINT`. The browser receives a short-lived signed `PUT` URL
after backend authorization and uploads directly to R2, not through the Vercel
request body. Legacy Supabase Storage objects remain readable, so retain
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET`
until those files have been migrated separately. Never expose R2 credentials
or the Supabase service-role key to Vite. Local development can still use the
filesystem when object-storage credentials are absent.

New object contents are SHA-256 deduplicated and recorded in `StoredFiles`;
`FileReferences` tracks resource associations. Reference removal only queues
unreferenced objects for delayed cleanup. Cleanup is an explicit maintenance
command (`npm run storage:cleanup` in `backend`) with a default 30-day grace
period; do not schedule it until object backups and retention requirements are
configured. Existing Supabase/local files are not bulk migrated or deleted.

Use `npm run storage:audit` to compare the selected provider's paginated object
listing with its file metadata and references; the command is read-only and
prints only aggregate counts and bounded samples. Legacy Supabase object
migration supports legacy `/uploads/<owner>/<uuid>.<extension>` references on
lessons, assignments, and submissions. First run
`npm run storage:migrate-legacy` for a dry run. After reviewing the result and
configuring R2, run `npm run storage:migrate-legacy -- --execute` (optionally
with `--limit=100` for a small batch). Each migrated file is validated,
SHA-256 deduplicated, verified after copying, and its database reference is
updated transactionally. The source object is retained. The command is
resumable; files with unsupported paths or failures are reported for manual
review. It does not migrate legacy chat attachments still stored in database
blobs. Do not schedule storage cleanup as part of this migration.

Configure `CRON_SECRET` as a backend-only secret with at least 32 random
characters in the Vercel project environment. Vercel invokes the protected
notification-outbox and deadline-reminder routes from `vercel.json`; verify
their HTTP status and `notification_outbox_processed`/`scheduled_task_failed`
logs in Vercel after deployment. Keep `SESSION_COOKIE_SAME_SITE=lax` when the
frontend and API are same-site; use `none` only when they are on separate sites
and HTTPS plus credentialed CORS are configured. Browser sessions use
HttpOnly cookies and expire after 12 hours; native clients keep bearer tokens.

## Operations, backups, and recovery

The application does not create database backups or configure a backup
retention policy automatically. Enable an appropriate backup/PITR retention
plan in Supabase for the production project's plan and compliance requirements,
and separately configure R2 bucket versioning or another object-retention
backup if required. Before a release involving schema changes, verify the
latest database recovery point and preserve the deployed application version.
Never use an application migration as a backup.

For a recovery exercise, restore a Supabase backup to a separate database
project, configure a non-production backend with that database, then run
`npm run migrate` and the backend test suite. Verify login, course enrollment,
assignment submission/grading, and notification records against the restored
database before considering it usable. Restore R2 objects from the configured
object backup independently; compare `npm run storage:audit` reports before
repointing production. Do not run `storage:cleanup` during recovery or before
the restored database references have been checked. Record the tested recovery
date, backup point, and any missing files in the operations runbook.

For operational monitoring, use Vercel function logs and cron execution
history, Supabase database/connection/storage metrics, and Cloudflare R2
storage metrics. Review HTTP error rates, scheduled-task failures, pending
notification deliveries, upload failures, database connection usage, and
storage audit differences regularly. These provider dashboards are not
replaced by the application's structured request logs.

During startup, the backend retries transient PostgreSQL connection failures
with a capped delay instead of exiting. It will not listen for API requests
until the database connects and migrations finish. If retries continue, verify
the provider is active, the connection URI uses the correct host/port/user, and
the provider CA is configured when required.

Help-center feedback is emailed to the configured personal recipient after the
user submits a 1–5 star rating and a written message. Public collaboration
messages are delivered to the configured school recipient. Both are sent by the
backend over SMTP; the browser does not open a mail application. Configure
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and
`SMTP_FROM` in `backend/.env` for local development and in the backend hosting
environment for deployment. Set `FEEDBACK_RECIPIENT_EMAIL` and
`COLLABORATION_RECIPIENT_EMAIL` to private recipient addresses. The forms
report a delivery error if SMTP or a recipient is not configured; they do not
show a success message unless delivery succeeds.

All routes below require a bearer token unless otherwise stated. The platform
has two roles: `student` and `lecturer`. Lecturers manage only courses they
own; students must be enrolled to read or submit course work. The
`20261004_03_lecturer_student_roles` migration converts legacy admin accounts
to lecturers, revokes their prior tokens, and restricts the database role enum
to those two roles. Both students and lecturers select a school and department
when registering. Public `GET /api/auth/academic-catalog` returns the supported
school/department choices. A Google account that already has a SmartCampus
account signs in directly; new Google accounts complete the same role-specific
profile details as email registration.

Student course discovery only returns active, open courses for the student's
school and department, plus courses the lecturer made available across the
school. Lecturers' courses are school-wide by default and can be limited to the
lecturer's own department. Students can join or leave from the course catalog;
the existing `POST /api/enrollments/join` class-code flow remains available.

| Area | Endpoints |
|---|---|
| Modules/progress | `GET/POST /api/courses/:courseId/modules`, `PATCH/DELETE /api/modules/:id`, `PATCH /api/lessons/:id/order`, `POST /api/lessons/:lessonId/progress`, `GET /api/courses/:courseId/progress` |
| Announcements | `GET/POST /api/courses/:courseId/announcements`, `PATCH/DELETE /api/announcements/:id` |
| Messages | `GET /api/courses/:courseId/conversations`, `GET /api/courses/:courseId/conversations/:userId`, `POST /api/courses/:courseId/messages` with `{ "recipientId": 7, "body": "..." }` |
| Notifications | `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `PATCH /api/notifications/read-all`, authenticated `POST/DELETE /api/notifications/devices` for opting a device into/out of native push |
| Timed assessments | `POST /api/quizzes/assessments` with course/title/time limit/questions and optional `maxAttempts` (1-10, default 1), `GET /api/quizzes/assessments/course/:courseId`, `GET /api/quizzes/assessments/:id`, `POST /api/quizzes/assessments/:id/attempts`, `PUT /api/quizzes/attempts/:attemptId/answers` with `{ "answers": { "questionId": "A" } }`, `POST /api/quizzes/attempts/:attemptId/submit`; students can retrieve their current/latest attempt at `GET /api/quizzes/assessments/:id/attempt`, and course managers can review attempts at `GET /api/quizzes/assessments/:id/attempts`. Legacy quiz endpoints remain unchanged. Correct answers are withheld until an attempt is submitted.
| Calendar/departments | Authenticated `GET /api/calendar?from=<ISO>&to=<ISO>` aggregates course events and assignment due dates for the current user's courses. Lecturers can manage typed `event`, `class`, `exam`, `deadline`, or `other` events through `GET/POST /api/courses/:courseId/calendar` and `PATCH/DELETE /api/calendar/:id`. Authenticated `GET /api/departments`; course lecturers can associate a department using `PATCH /api/courses/:id/department`. |
| Gradebook/certificates | Manager-only `GET /api/courses/:courseId/gradebook` (optional `limit=1..100&offset=0..` student pagination; omitted parameters preserve the existing full response) and `/analytics`; student `GET /api/assignments/my/submissions`, `GET /api/certificates`, `POST /api/courses/:courseId/certificate` |

Authenticated `GET /api/search?q=<text>` powers the navbar's live search. It
searches courses, assignments, learning materials, modules, and announcements
within courses owned by the lecturer or enrolled by the student. The query
accepts a single character, is capped at 80 characters, and returns at most
five results per content type. Private submissions, grades, and chat messages
are intentionally excluded.

Certificates are issued once per student/course when at least one lesson exists
and all course lessons are marked complete. Assignment grading accepts optional
`feedback`. Assignment, announcement, message, grading, assessment, and
calendar creation writes recipient-scoped notifications in the same database
transaction. When a recipient opted in with a registered Expo device token,
the backend dispatches a best-effort native push after the notification
transaction commits. Failed pushes do not roll back in-app notifications.
Tokens are validated on the backend, scoped to the authenticated user, and
removed after Expo reports a device is no longer registered. Student phone
numbers are optional and are not used to send push notifications. Changing a
password revokes prior JWTs; old tokens without a
token-version claim remain valid only while the account version is zero.

## Student chat

Chat messages use Supabase Realtime when configured. The backend exchanges the
existing SmartCampus session for a short-lived Supabase JWT whose subject is
the chat profile UUID; row-level policies then restrict group messages to
course members and private messages to students who still share a course.
When using local PostgreSQL, Supabase Auth is not installed, so the backend
skips Supabase-specific chat row-level security setup and logs a warning;
chat requests still use the backend's authorization checks. Supabase Realtime
requires the deployed Supabase database and its Auth schema. Production startup
fails if that schema is unavailable.
Configure backend-only `SUPABASE_JWT_SECRET` from Supabase Project Settings →
API, and set the public `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the
frontend build environment. The anon key is public; never expose the database
password, service-role key, or JWT signing key to Vite. Server-sent events
provide authenticated presence/typing updates and a message-delivery fallback.
The in-memory presence/typing relay is intended for a single backend instance;
use a shared pub/sub adapter before scaling the API horizontally.

Configure `GIPHY_API_KEY` in the backend environment to enable GIF/sticker
search. The backend uses GIPHY's GIF and sticker search endpoints and requests
general-audience (`g`) results. Voice notes are limited to 5 MB and stored in
private object storage for new uploads; legacy media rows remain readable from
PostgreSQL until they are explicitly migrated. Users can stream attachments
only after the backend rechecks their course membership or private
conversation. Saved and hidden messages are persisted per chat profile.

Configure `OPENAI_API_KEY` in the backend `.env` file to enable the AI
assistant. The key must remain server-side; do not put it in a frontend
`VITE_` variable or commit it to source control. The assistant uses the
`gpt-4o-mini` model through OpenAI's API.
