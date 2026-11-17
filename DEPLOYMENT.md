# Deploy SmartCampus on Vercel

The root `vercel.json` deploys the Vite frontend and Express API as two Vercel
Services. Both are public on the same origin: the API is routed under `/api/*`
and all other paths go to the frontend. The frontend calls the API through
same-origin `/api` URLs, so no service binding is needed.

## Native mobile push notifications

The `mobile/` directory contains an Expo Android/iOS companion. It uses
authenticated SmartCampus accounts and Expo Push Tokens; student phone numbers
are not used for push delivery. Student phone numbers remain optional at
registration, and the backend validates them whenever supplied. Account
registration remains on the existing web app.

Push notification delivery is best-effort after the existing LMS notification
transaction commits. The in-app notification remains saved if the Expo push
service is unavailable. The backend creates its `NotificationDevices` table
through the existing Sequelize model sync.

To build the mobile app, follow `mobile/README.md`. Configure
`EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_EAS_PROJECT_ID` in the EAS build
environment; configure FCM v1 and APNs credentials in the Expo project's
credential settings. Build and install a development or production app on a
physical device to test remote notifications; Expo Go does not support remote
push for the current SDK. No mobile push secrets belong in Vite variables or
the backend environment.

## Important platform limits

- Vercel hosts the frontend and API, but it does not host this project's
  PostgreSQL database. Use Supabase PostgreSQL and configure the backend
  connection variables below.
- New course materials, assignment files, submissions, quiz-import documents,
  and chat media upload directly to a private Cloudflare R2 bucket when
  `FILE_STORAGE_PROVIDER=r2`; chat profile images are stored server-side. Existing Supabase Storage objects
  remain readable. Default limits are 20 MB for materials, submissions, and
  quiz imports; 5 MB for chat media; and 2 MB for stored profile images. Do not
  rely on Vercel's temporary filesystem for persistent files.
- Direct browser-to-storage uploads avoid Vercel's function request-size limit;
  only a small, authenticated upload authorization request and file metadata go
  through the API. Downloads still pass through the API's access checks before
  a short-lived private download link is issued.

## 1. Prepare Supabase PostgreSQL

Create or select a Supabase project, then open **Project Settings → Database**
and copy its PostgreSQL connection URI. Use the Supabase session pooler URI if
Vercel cannot reach the direct database host. The URI includes a database
password; keep it private and URL-encode special characters in the password.
The backend uses Sequelize for every existing `/api/*` route, so the existing
accounts, courses, lessons, assignments, quizzes, grades, announcements,
feedback, chat, and other API data all use this PostgreSQL database. No
duplicate Supabase REST routes are needed.

Use `DB_SSL=true` and a small connection pool (`DB_POOL_MAX=2`) for serverless
instances. The backend applies its additive migrations and creates missing
tables at startup; do not manually create application tables or use
`sequelize.sync({ alter: true })`. A database user with schema/table creation
and migration privileges is required for the initial deployment.

Vercel initializes the database on the first API invocation in each backend
instance, then runs the existing migrations and Sequelize sync. Allow the first
API request after a deploy to take longer than later requests.

## 2. Configure private file storage

Create a **private** Cloudflare R2 bucket and an R2 API token scoped to that
bucket. The backend needs object read/write/delete access; it does not need a
public bucket or public URL. R2's S3 endpoint defaults to
`https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`; set `R2_ENDPOINT` only if a
custom endpoint is required.

Configure the bucket's CORS policy to allow `PUT` from each SmartCampus
frontend origin, with the `Content-Type` request header. Do not allow arbitrary
origins. The browser only receives a short-lived signed upload URL; all R2
credentials remain backend-only. Add a bucket lifecycle rule to expire
`staging/` objects after one day so abandoned, interrupted uploads do not
accumulate; finalized objects use the separate `objects/` prefix.

R2 currently includes 10 GB-month of Standard storage, 1 million Class A
requests, 10 million Class B requests, and free egress per month. Usage above
the included monthly limits is billed at Cloudflare's published rates; the
free tier is not unlimited. Review current
[R2 pricing](https://developers.cloudflare.com/r2/pricing/) and set account
billing alerts before production use.

Keep the existing Supabase Storage bucket and backend credentials configured
while legacy Supabase file references remain. The application does not migrate
or delete those objects automatically. Existing local-disk files likewise are
not moved automatically; retain a backup and re-upload them through the app if
they must be kept.

If you are not enabling R2 yet, create a **private** Supabase Storage bucket
named `smartcampus-files`, set its maximum file size to **20 MB**, and allow
the following MIME types:

`application/pdf`, `application/msword`,
`application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
`application/vnd.ms-powerpoint`,
`application/vnd.openxmlformats-officedocument.presentationml.presentation`,
`application/vnd.ms-excel`,
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
`text/plain`, `text/csv`, `application/zip`, `application/octet-stream`,
`image/jpeg`, `image/png`, `image/gif`, `image/webp`, `audio/webm`,
`audio/mp4`, `audio/ogg`, `audio/mpeg`, and `audio/wav`.

Set `FILE_STORAGE_PROVIDER=supabase` to use Supabase Storage for new uploads.
The backend issues signed upload grants after checking the authenticated user's
course role and permissions and validates uploaded content before storing its
reference. Keep the bucket private; never expose the service-role key.

## 3. Import the repository into Vercel

1. Push the repository to GitHub if it is not already there.
2. In the [Vercel dashboard](https://vercel.com/dashboard), select **Add New →
   Project** and import the repository.
3. Keep the **Root Directory** as the repository root (`.`), not `frontend` or
   `backend`. The root `vercel.json` contains the combined frontend/API setup.
4. Leave the build settings controlled by `vercel.json`. Vercel builds each
   service from its own directory; the frontend publishes its `dist` output.
5. Add the environment variables below before deploying, then select **Deploy**.

## 4. Configure project environment variables

In Vercel, open **Project → Settings → Environment Variables** and add the
backend R2 variables there for **Production** (and **Preview** only if preview
deployments should use the bucket). Do not add any R2 credential as a
`VITE_*` variable. The public Vite variables below are for browser-side
Supabase Realtime only.

| Variable | Value |
|---|---|
| `DB_DIALECT` | `postgres` |
| `DATABASE_URL` | Supabase PostgreSQL connection URI from Project Settings → Database |
| `DB_SSL` | `true` |
| `DB_POOL_MAX` | `2` for serverless functions |
| `JWT_SECRET` | Random secret of at least 32 characters |
| `GOOGLE_CLIENT_ID` | Google OAuth Web client ID |
| `CLIENT_URL` | Comma-separated frontend origins, e.g. `https://your-project.vercel.app` |
| `SUPABASE_JWT_SECRET` | Backend-only Supabase JWT signing secret; required for chat Realtime tokens |
| `SUPABASE_URL` | Supabase project URL for backend Storage access and Realtime |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend-only key for legacy Supabase files or when Supabase is selected |
| `SUPABASE_STORAGE_BUCKET` | Private legacy/fallback Storage bucket; use `smartcampus-files` |
| `FILE_STORAGE_PROVIDER` | `r2` for new Cloudflare uploads; `supabase` to use Supabase Storage |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Backend-only Cloudflare R2 account, bucket, and scoped API credentials |
| `R2_ENDPOINT` | Optional R2 S3-compatible endpoint; defaults from `R2_ACCOUNT_ID` |
| `FILE_MAX_MATERIAL_MB`, `FILE_MAX_CHAT_MB`, `FILE_MAX_PROFILE_MB` | Optional backend upload limits; defaults are `20`, `5`, and `2` |
| `FILE_ORPHAN_GRACE_DAYS` | Optional deferred-cleanup grace period; defaults to `30` days |
| `CRON_SECRET` | Random backend-only secret with at least 32 characters for Vercel scheduled tasks |
| `SESSION_COOKIE_SAME_SITE` | Optional browser cookie policy; defaults to `lax`, use `none` only for cross-site HTTPS |
| `VITE_SUPABASE_URL` | Public Supabase project URL for browser chat Realtime |
| `VITE_SUPABASE_ANON_KEY` | Public Supabase anon/publishable key for browser chat Realtime |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Required SMTP settings for feedback and collaboration email delivery |
| `FEEDBACK_RECIPIENT_EMAIL`, `COLLABORATION_RECIPIENT_EMAIL` | Required private recipient addresses for feedback and collaboration messages |
| `OPENAI_API_KEY` | Optional; only needed for the AI assistant |
| `VITE_ENABLE_AI_ASSISTANT` | Set to `true` to show the AI assistant button; leave `false` until `OPENAI_API_KEY` is configured |
| `TENOR_API_KEY` | Required for chat GIF/sticker search |

`PORT` is managed by Vercel and is not required. Do not set `VITE_API_URL` for
this same-origin deployment. Redeploy after changing frontend environment
variables because Vite embeds them at build time. Google sign-in reads its
public client ID from the backend configuration, so `VITE_GOOGLE_CLIENT_ID` is
optional; set it only if you want to configure the browser button directly.

If the frontend calls a separately hosted backend, set `CLIENT_URL` in the
backend environment to the exact frontend origin (scheme and hostname, with no
path or trailing slash). Multiple origins can be comma-separated. Add each
frontend preview origin to the Preview environment as needed, then redeploy the
backend. Do not use `*` for credentialed CORS requests.

Do not put `.env` files, database credentials, JWT secrets, or API keys in Git.
`VITE_*` values are included in browser code: only the Supabase anon/publishable
key and other explicitly public values belong there. Never expose the database
password, service-role key, or `SUPABASE_JWT_SECRET` to the frontend.

Supabase Realtime chat also requires the Supabase Auth schema. The backend
configures chat row-level security and adds the chat messages table to the
Realtime publication during initialization. Set `SUPABASE_JWT_SECRET` from the
Supabase project's JWT signing configuration; this is separate from the anon
key. If Realtime is unavailable, the chat API retains its authenticated
server-sent-events fallback.

`SUPABASE_URL` and `VITE_SUPABASE_URL` must refer to the same Supabase project.
The backend service-role key and all R2 credentials must never use a `VITE_`
prefix. `VITE_SUPABASE_ANON_KEY` is public and is used for Supabase Realtime
and optionally Supabase Storage; the R2 provider never needs R2 credentials or
an `R2_PUBLIC_URL` in the browser.

## 5. Finish Google sign-in configuration

In Google Cloud Console, open the OAuth Web client and add the Vercel site's
origin to **Authorized JavaScript origins** (for example,
`https://your-project.vercel.app`). Add any custom domain you use as a separate
origin. The origin must not include a path or trailing slash.

Set `GOOGLE_CLIENT_ID` in the backend environment and redeploy after changing
Vercel environment variables. If `VITE_GOOGLE_CLIENT_ID` is also set, it must
match the backend value.

## 6. Verify the deployment

After deployment:

1. Open `https://your-project.vercel.app/`; the SmartCampus login page should
   load.
2. Open `https://your-project.vercel.app/api/health/live`; the API should return
   `{"status":"ok"}`.
3. Open `https://your-project.vercel.app/api/health`; it should return
   `{"status":"ok","database":"connected"}`.
4. Test Google sign-in and password sign-in with test accounts.
5. Review **Vercel → Project → Functions → Logs** if an API request fails.

The backend service has a 60-second maximum function duration configured to
accommodate database initialization and external identity verification.

6. Test uploading a course material larger than 4 MB but no larger than 20 MB,
   then download it as an enrolled student and verify that an unauthorized
   account cannot access it.

## 7. Storage behavior

The PostgreSQL database is hosted by Supabase, not by Vercel. Uploaded files are
stored in the selected private object-storage provider; PostgreSQL contains
metadata and references, not new file bytes. Quiz document extraction and chat
media are staged in Storage to bypass Vercel request-size limits. The backend
deduplicates finalized objects by SHA-256 and retains legacy Supabase/local
files as-is. Database references are removed transactionally and objects become
eligible for cleanup only after a 30-day grace period. Run
`npm run storage:cleanup` from `backend` only after configuring backups and
confirming retention policy; it deletes only metadata-marked objects that have
zero references and rechecks that condition while holding a database lock.
This cleanup is not an always-running background task on Vercel.
