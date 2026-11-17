# SmartCampus LMS

SmartCampus LMS is a web-based learning management system for students and
lecturers. It brings course enrollment, learning materials, assignments,
quizzes, grades, announcements, calendars, and course communication together
in one responsive application.

**Project documentation:** [Read or download the full project document](docs/PROJECT_DOCUMENTATION.md).
It covers the product, architecture, development tools and stages, local setup,
testing, deployment, and operational/security guidance.

## What the application includes

- Student and lecturer accounts, password authentication, and Google sign-in.
- Course discovery, enrollment, course pages, lessons, and learning materials.
- Assignment creation, submission, and status; quizzes and grades.
- Announcements, course calendars, notifications, and dashboards.
- Course and private chat, media search, saved messages, reactions, and
  connectivity-aware message handling.
- Feedback and collaboration requests.
- Responsive layouts and installable Progressive Web App (PWA) support.
- Optional Android and iOS companion app for native device notifications
  (`mobile/`; Expo EAS build and platform push credentials required).
- Optional AI assistant integration.

Available functionality can depend on account role and the relevant service
configuration.

## Technology

| Area | Main tools |
|---|---|
| Frontend | React 19, Vite 8, React Router, Axios |
| API | Node.js 18+, Express 5 |
| Data | PostgreSQL, Sequelize 6 |
| Storage and realtime | Supabase PostgreSQL/Storage; optional Supabase Realtime |
| Authentication | JWT, bcrypt, optional Google Identity |
| Deployment | Vercel frontend and backend services |
| Quality checks | ESLint, Node.js built-in test runner |

See the [full project documentation](docs/PROJECT_DOCUMENTATION.md) for the
architecture overview and development history.

## Run locally

Prerequisites: Node.js 18 or later, npm, and a PostgreSQL database. The hosted
deployment uses Supabase PostgreSQL; local development can use a PostgreSQL
instance you manage.

1. Install each application's dependencies:

   ```powershell
   Set-Location backend
   npm install
   Set-Location ..\frontend
   npm install
   Set-Location ..\mobile
   npm install
   Set-Location ..
   ```

2. Copy the backend environment template and configure it for your local
   database and required integrations:

   ```powershell
   Copy-Item backend\.env.example backend\.env
   ```

   Edit `backend\.env` locally. Never commit it or share its secret values.
   Frontend-specific local settings belong in an appropriate `frontend\.env.*`
   file; see `DEPLOYMENT.md` for the supported variables and their purpose.

3. Start the web applications from the repository root:

   ```powershell
   npm run dev
   ```

   The frontend is normally available at `http://localhost:5173` and the API
   at `http://localhost:5000`. If you prefer separate terminals, run
   `npm run dev` in `frontend` and `npm run dev` in `backend`.

   For native notification development, copy `mobile\.env.example` to
   `mobile\.env`, set the API origin and Expo EAS project ID, then follow
   [mobile/README.md](mobile/README.md) to create a device build and configure
   Android/iOS push credentials. Remote notifications require an installed
   development or production build on a physical device; they do not work in
   Expo Go.

Optional seed data:

```powershell
Set-Location backend
npm run seed
```

## Verify changes

Run the relevant checks from the repository root:

```powershell
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix backend test
```

The backend tests use Node's built-in test runner. Tests that require a database
or external integrations may need the corresponding test environment.

## Deployment

The root `vercel.json` configures the Vite frontend and Express backend as
Vercel services and routes `/api/*` requests to the backend. Vercel does not
provide the PostgreSQL database or persistent file storage: configure
PostgreSQL and a private Cloudflare R2 bucket (or the legacy Supabase Storage
provider) separately.

Follow [DEPLOYMENT.md](DEPLOYMENT.md) for the deployment procedure, environment
variables, Google sign-in, storage setup, and health-check steps. Do not copy
secrets into frontend `VITE_*` variables: Vite values are public in the
generated browser application.

## Repository map

```text
backend/       Express API, controllers, routes, models, middleware, tests
frontend/      React application, pages, components, styles, public assets
api/           Deployment API entry point
scripts/       Local development helpers
DEPLOYMENT.md  Vercel, database, storage, and environment setup
docs/          Full project documentation
```

## Security and operations

- Keep `.env` files, database URLs, JWT signing secrets, and service-role keys
  out of source control.
- Treat all `VITE_*` values as public. Only explicitly public client-side
  configuration belongs there.
- Keep object-storage buckets private and use backend-issued, short-lived
  access controls for uploads and downloads.
- Configure production CORS origins, authentication, and external services
  according to `DEPLOYMENT.md`.
- Back up the PostgreSQL database and any files that must be retained. Vercel's
  filesystem is not persistent storage.
- Review [privacy and authentication controls](docs/PRIVACY-AND-DATA-PROTECTION.md)
  before production; institutional legal approval is required for retention,
  processing purposes, and data-request deadlines.

## Project documentation

The standalone [SmartCampus LMS project document](docs/PROJECT_DOCUMENTATION.md)
is Markdown and can be opened in GitHub or downloaded from the repository. It
is also suitable for conversion to PDF using a Markdown editor or document
converter.
