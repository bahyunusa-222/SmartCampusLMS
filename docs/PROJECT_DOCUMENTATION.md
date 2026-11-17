# SmartCampus LMS — Project Documentation

**Project:** SmartCampus LMS  
**Project type:** Web-based learning management system  
**Primary users:** Students and lecturers  
**Repository:** [bahyunusa-222/SmartCampusLMS](https://github.com/bahyunusa-222/SmartCampusLMS)  
**Deployment:** Vercel frontend and API services, with PostgreSQL and file storage configured separately

This document describes the application, its technology and architecture, how
to run and verify it, and the development stages visible in the repository.
It is intended as a project handover and can be downloaded as a Markdown file
from the repository.

## 1. Project overview

SmartCampus LMS provides a shared online space for teaching and learning.
Students can discover and join courses, work through course materials, submit
assignments, take quizzes, review released grades, and communicate with
classmates and lecturers. Lecturers can manage course content and learning
activities, publish announcements, and use course communication and calendar
features.

The application includes account authentication, dashboards, notifications,
responsive layouts, and installable Progressive Web App (PWA) support. Some
features depend on user role or optional external services and therefore
require the corresponding configuration.

### Main user-facing capabilities

| Area | Capabilities |
|---|---|
| Accounts | Registration, password login, password reset, profile settings, and optional Google sign-in |
| Courses | Course discovery, enrollment, course pages, lessons, and learning materials |
| Coursework | Assignments, submissions, quizzes, grades, and certificates |
| Teaching tools | Course content management, announcements, calendars, and learner-facing activity |
| Communication | Course messages, private chat, presence, reactions, saved messages, and media |
| Support | Feedback, collaboration requests, notifications, and optional AI assistance |
| Devices | Responsive mobile layouts and installable PWA experience |

The exact permissions and available actions are enforced by the application;
this table is a product overview, not a complete role/permission specification.

## 2. Technology and development tools

The following tools and frameworks are declared in the project manifests or
deployment configuration.

| Layer | Tools |
|---|---|
| Browser application | React 19, React DOM, Vite 8, React Router 7, Axios |
| UI support | React Icons, emoji-picker-react, project CSS |
| API server | Node.js 18+, Express 5 |
| Data access | Sequelize 6, PostgreSQL (`pg`, `pg-hstore`) |
| Authentication | JSON Web Tokens (`jsonwebtoken`), bcrypt, optional Google Identity |
| File storage and realtime | Supabase JavaScript clients, Supabase PostgreSQL/Storage, optional Supabase Realtime |
| Email | Nodemailer and configured SMTP service |
| Media search | GIPHY and Tenor integrations, subject to API configuration |
| Deployment | Vercel services configured in `vercel.json` |
| Code quality and tests | ESLint and Node.js built-in test runner |

Additional backend dependencies support file uploads and processing,
spreadsheet exports, archive handling, XML parsing, and document text
extraction. The exact dependency versions are maintained in
`frontend/package.json` and `backend/package.json`.

The repository does not establish which code editor, design software, or
individual development hardware was used. Those tools are intentionally not
claimed here.

## 3. Architecture

```text
Student or lecturer browser
          |
          | React application; same-origin /api requests in production
          v
Vercel frontend service  --->  Vercel backend service (Express API)
                                       |
                                       +--> PostgreSQL via Sequelize
                                       |
                                       +--> Private Cloudflare R2 (new files)
                                       +--> Private Supabase Storage (legacy)
                                       |
                                       +--> Optional Supabase Realtime
                                       |
                                       +--> Configured external services
                                            (Google, SMTP, media, optional AI)
```

### Frontend

The frontend is a single-page React application built with Vite. Its pages and
components provide role-specific learning and teaching screens. In production,
the frontend uses same-origin API routes, and Vercel routes `/api/*` to the
backend service. Local development uses a frontend development server and a
separately running API server.

### Backend API

The backend is an Express application organized into routes, controllers,
models, middleware, and supporting services. It handles authentication,
authorization, validation and application operations. API access is protected
according to the relevant user session and role.

### Data and file storage

Sequelize connects the API to PostgreSQL. Supabase can host the production
PostgreSQL database. New objects can use a private Cloudflare R2 bucket through
its S3-compatible API; existing Supabase Storage objects remain readable.
`StoredFiles` records SHA-256 metadata, while `FileReferences` tracks the
resources that use each physical object. Files should not rely on Vercel's
temporary filesystem for persistence.

### Chat and external services

Chat functionality uses authenticated API operations. Supabase Realtime can
provide live updates; the API also includes a server-sent-events fallback when
Realtime is unavailable. Email, Google sign-in, media search, and the optional
AI assistant require their respective service configuration.

## 4. Development stages

The project owner reports that development took approximately a year. The
repository history available for this checkout records visible milestones from
May 22 through November 7, 2026. The phases below reconstruct the work from
commit subjects; they are not a day-by-day schedule or an independent
verification of the full year.

| Stage | Repository evidence | Outcome |
|---|---|---|
| Initial project setup | Initial commits dated May 22, 2026 | Repository and early project foundation |
| Frontend and deployment foundations | React project and deployment configuration commits dated June 28–29, 2026 | React application structure and early hosting setup |
| Core learning features | Course, announcement, calendar, lesson, quiz, and messaging milestones dated October 5–11, 2026 | Expansion into the core LMS workflows and role-oriented settings |
| Production authentication and hosting | Google sign-in and Vercel migration milestones dated October 8–28, 2026 | Authentication integration, API health checks, and Vercel deployment structure |
| Database and serverless reliability | Database export, initialization, environment validation, and Vercel bundling fixes dated November 3–5, 2026 | Improved compatibility between Sequelize and deployment/runtime bundling |
| Course discovery and mobile experience | School-scoped course discovery, mobile navigation, chat, and assignment milestones dated November 6, 2026 | Better mobile course workflows, offline chat media support, and expanded media search |
| Delivery and install experience | Chat delivery and install experience milestone dated November 7, 2026 | Message status handling and install prompt/PWA improvements |

These are engineering stages inferred from available commit history. The
chronology does not imply that each feature was completed only on the date of
its associated commit.

## 5. Local development

### Prerequisites

- Node.js 18 or later and npm.
- PostgreSQL for local API development.
- Optional service accounts/credentials for Google sign-in, Cloudflare R2 or
  legacy Supabase Storage, Supabase Realtime, SMTP email, media search, and AI
  features.

### Install

From the repository root in PowerShell:

```powershell
Set-Location backend
npm install
Set-Location ..\frontend
npm install
Set-Location ..
```

Create a local backend environment file from the template:

```powershell
Copy-Item backend\.env.example backend\.env
```

Configure `backend\.env` for a local PostgreSQL database and any integrations
you intend to use. Do not copy production credentials into a local file that
will be committed. Frontend development variables, when needed, belong in an
appropriate `frontend\.env.*` file.

### Start the application

Start both services from the repository root:

```powershell
npm run dev
```

The frontend is normally served at `http://localhost:5173` and the API at
`http://localhost:5000`. To run them separately, use `npm run dev` in each of
the `frontend` and `backend` directories.

Optional seed data:

```powershell
Set-Location backend
npm run seed
```

## 6. Testing and build checks

Run the frontend lint, production build, and backend test suite from the
repository root:

```powershell
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix backend test
```

The frontend scripts are defined in `frontend/package.json`; backend scripts,
including `test`, `seed`, and `migrate`, are defined in
`backend/package.json`. Database-dependent tests and features require a
correctly configured test environment.

## 7. Deployment

The root `vercel.json` describes the Vercel frontend and backend services. The
frontend is built with Vite and serves the single-page application. Requests
under `/api/*` are routed to the Express backend.

Deployment requires services beyond Vercel:

1. A PostgreSQL database; the documented production setup uses Supabase
   PostgreSQL.
2. A private Cloudflare R2 bucket for new uploads, or the private legacy
   Supabase Storage bucket while retaining old files.
3. Vercel environment variables for the database, authentication, and enabled
   integrations.
4. Correct Google OAuth origins, SMTP settings, and service API keys for any
   optional integrations being used.

Use the repository's [DEPLOYMENT.md](../DEPLOYMENT.md) as the authoritative
step-by-step guide. It lists environment variable names, storage configuration,
deployment checks, and health endpoints. Do not infer that a service is active
merely because its library is installed.

## 8. Security, privacy, and operations

- Never commit `.env` files, database credentials, password/app-password
  values, JWT secrets, Supabase service-role keys, or private third-party API
  credentials.
- Treat all `VITE_*` variables as public browser configuration. Do not place
  private keys or service-role credentials in frontend variables.
- Keep uploaded-file buckets private. Use authenticated, permission-checked
  operations and short-lived upload/download grants where configured.
- Use exact trusted origins for credentialed CORS; do not use a wildcard
  origin for authenticated requests.
- Use HTTPS for deployed services and configure strong, unique secrets for
  production.
- Maintain database backups and an operational recovery procedure. Vercel's
  filesystem is temporary and is not a backup or persistent file store.
- Verify access controls for both student and lecturer accounts after changes
  to course, file, chat, or grading behavior.

## 9. Repository map

```text
api/           Vercel API entry point
backend/       Express API, tests, scripts, routes, models, and controllers
frontend/      React application, pages, components, styles, and public assets
scripts/       Root development helper scripts
DEPLOYMENT.md  Hosting, environment, database, and storage guide
README.md      Repository quick start and project summary
docs/          Project documentation
```

## 10. Source-code comments

This document explains the system at project level. The source code is not
annotated on every line: repeating each statement as a comment makes code
harder to scan and maintain. Comments are most useful for non-obvious decisions,
invariants, and complex behavior; names, types, tests, and focused
documentation should explain routine code.

---

For local setup and a concise project overview, see the repository
[README](../README.md). For deployment-specific instructions, see
[DEPLOYMENT.md](../DEPLOYMENT.md).
