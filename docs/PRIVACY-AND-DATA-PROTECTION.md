# SmartCampus privacy and authentication controls

This document records the application controls present in this repository and the decisions that still require University of The Gambia (UTG) approval. These controls do not establish compliance with the Personal Data Protection and Privacy Act 2025, GDPR, or any other law. UTG's designated data controller, privacy officer, and legal counsel must approve purposes, lawful bases, retention schedules, response deadlines, processor terms, and operational procedures before production use.

## Authentication audit and implemented controls

SmartCampus uses application-managed passwords and JWT sessions backed by Sequelize/PostgreSQL; Supabase Auth does not manage these accounts. Browser sessions use an HttpOnly cookie. The mobile app uses its existing native secure credential storage and bearer-token flow.

- New password hashes use Argon2id (19,456 KiB memory, time cost 2, parallelism 1), with a unique random salt encoded in each hash. These OWASP baseline parameters still need benchmarking on the actual Vercel runtime.
- Existing bcrypt hashes are accepted at login and upgraded to Argon2id after successful verification. Google-only accounts remain on the existing Google sign-in path.
- Passwords must be 12–128 Unicode code points and at most 1,024 UTF-8 bytes. Spaces and Unicode are supported. A small built-in common-password denylist is used; it is not a comprehensive breached-password service.
- The `User` default scope excludes the password and reset-token fields. Authentication code that needs a stored hash explicitly uses an unscoped query. API user serialization removes password and Google ID fields.
- Password reset tokens are random, single-use, stored only as SHA-256 hashes, and expire after 30 minutes. Successful resets increment `tokenVersion`, invalidating issued JWTs. Reset links carry the one-time token in the URL fragment (not a query string or server request); the frontend clears the fragment before submitting it to the API. Reset tokens are never returned by the API.
- Email/password registration can be used to sign in immediately; email verification is optional and does not gate password login. Verification tokens are random, stored as SHA-256 hashes, expire after 30 minutes, and are consumed once. Google-verified accounts are treated as verified. Because unverified email addresses are not proof of identity, account email ownership must not be relied on until verified; password recovery remains limited to verified accounts.
- Changing an email address requires the current password and verifies the new address. Password changes also require the current password and revoke existing JWTs.
- Before browser sign-in or registration, visitors must accept the current Terms and Conditions and choose either essential-only or all cookies. Essential session storage remains enabled; optional analytics and advertising cookies are not currently used. The choice and terms version are stored in that browser and must be renewed when the terms version changes.
- JWTs expire after six hours; browser cookies are HttpOnly, Secure in production, and SameSite-configurable (Lax by default). Logout/password changes/resets revoke JWTs through `tokenVersion`.
- Security-event records cover login outcomes, password and reset changes, email verification, and privacy requests/exports. The application model prevents updates/deletes through Sequelize hooks, but database-level immutability and restricted log access still require operational controls.

### Known authentication gaps

- There is no refresh-token rotation, refresh-token reuse detection, or per-device session registry/revocation. Six-hour JWT expiry and global `tokenVersion` revocation are the current controls.
- MFA/TOTP and recovery codes are not implemented.
- There is no dedicated CSRF-token mechanism. Browser cookie requests currently rely on SameSite=Lax plus the configured CORS origin allowlist; custom-domain/subdomain deployment must be reviewed before relying on that boundary.
- Account recovery and email delivery depend on configured SMTP or the existing reset-delivery integration. Production delivery and domain/link configuration must be tested before enabling email registration.
- Expired reset and verification rows are rejected by expiry checks but do not yet have a scheduled cleanup job.
- A compromised-password service, production Argon2 benchmarking, and broader auth abuse monitoring remain operational follow-ups.

## Self-service privacy controls

Authenticated users can open **Settings → Privacy and data**:

- Request access, correction, erasure, restriction, portability, or objection. Requests are bound to the authenticated user and remain in `received` status; no deletion occurs automatically.
- Download a JSON export containing an allowlisted profile, enrollment, assignment submission, lesson-progress, quiz-attempt, privacy-request, and optional-consent history.
- View/change optional product-communication and analytics consent. Changes are versioned, timestamped records; essential education-service processing is not presented as optional consent.
- View their own request statuses. No administrative dashboard or privileged request-processing endpoint is included.

The export is intentionally scoped and is not a complete archive: chat history, uploaded file contents, and some institutional records are excluded. Those require a reviewed data map and controlled export implementation. There is no user-facing deletion execution workflow. Erasure requests are recorded for institutional review so legally or academically required records are not removed automatically.

Consent choices are stored as versioned history but are not yet wired to optional campaign or analytics senders. Those features must read the latest consent before any optional processing is enabled.

Response deadlines are nullable and are not invented in application code. The University must approve an applicable legal deadline and operating procedure. Until then, requests are acknowledged as received but do not promise a completion date.

## Personal-data inventory (initial)

The database and application integrations are the current locations to verify; actual hosting regions, retention periods, and access grants must be confirmed from deployed configuration and contracts.

| Data category | Purpose | Current storage / processors | Expected access | Retention and deletion status |
|---|---|---|---|---|
| Student/lecturer identity, email, role, student ID, phone, school and department | Account, enrollment, and learning services | PostgreSQL via Supabase; application hosted on Vercel | Account owner; authorized course workflows | No approved schedule encoded; institution must set account/archive rules |
| Password hashes, reset and verification token hashes, JWT/session version | Authentication and account recovery | PostgreSQL; Vercel runtime; SMTP receives verification/reset links | Authentication services only; never included in normal user responses | Reset/verification links expire in 30 minutes; expired database rows need cleanup |
| Courses, enrollment, academic progress, grades, quiz attempts and assignment submissions | Deliver education and maintain academic records | PostgreSQL; private R2 objects may be referenced for submitted files | Student for own records; authorized lecturer/course operations | Academic retention must be approved; no automated erasure on request |
| Uploaded materials, assignment files, profile images, and chat attachments | Learning resources and communication | Cloudflare R2 objects plus PostgreSQL metadata/references | Authorized users according to application resource permissions | File lifecycle/orphan cleanup exists separately; academic retention schedule remains unapproved |
| Chat messages and attachments | User communication | PostgreSQL and R2 where attachments are stored | Conversation participants and authorized application operations | No institution-approved retention schedule documented here |
| Device/push tokens and notification delivery records | Deliver opted-in or operational notifications | PostgreSQL; Expo push service receives device token and notification payload | Notification services; account owner manages registered devices where supported | Token cleanup should follow revocation/provider responses; overall retention unapproved |
| IP/request identifiers and security events | Abuse detection, accountability, and diagnostics | Application logs on Vercel and PostgreSQL security-event records | Restricted operations/security access; no user-facing event search | Retention/access policy and database-level tamper protections require approval |
| Privacy requests and optional-consent history | Track requests and consent choices | PostgreSQL | Request owner; future institution-authorized review process | Keep only under an institution-approved accountability schedule |

## Third-party processing register

| Provider | Data potentially processed | Required verification |
|---|---|---|
| Supabase/PostgreSQL | Account, academic, communication, file metadata, privacy, and security records | Confirm region, backups, access roles, subprocessors, DPA, transfer safeguards, and restore controls |
| Vercel | Application requests, deployment/runtime data, and potentially request/IP logs | Confirm region, log retention, access controls, DPA, and cross-border transfer terms |
| Cloudflare R2 | Uploaded object contents and object metadata | Confirm account region/processing, private bucket and signed access policies, lifecycle, DPA, and transfer safeguards |
| Expo push service | Device push tokens and notification delivery payloads | Minimize payload personal data; confirm retention, subprocessors, contracts, and transfer safeguards |
| SMTP/email provider | Recipient email and verification/password-reset links | Confirm provider, message retention, region, DPA, TLS, and account-security controls |
| Google identity services (optional sign-in) | Google credential verification and verified email/name claims | Confirm OAuth configuration, claim minimization, contractual terms, and transfer safeguards |

These providers do not automatically make SmartCampus legally compliant. UTG must identify the controller, approve processor agreements and cross-border transfers, and publish accurate notices.

## Retention and deletion decisions required

No unapproved duration is hard-coded as a legal retention period. UTG should approve a schedule that separately defines:

1. Academic records (grades, attendance, submissions, progress, and course participation), including archive and appeal windows.
2. Inactive and closed accounts, including whether identity fields are anonymized while academic records are retained.
3. Chat content, attachments, profile images, and other user-generated content.
4. Device tokens, delivery receipts, reset/verification token rows, security events, and operational logs.
5. Backup expiration, object-storage lifecycle, legal holds, and deletion verification.

Until approved, do not automatically delete academic or financial records in response to an account-erasure request. Verify the requester's identity, record the decision and legal basis, restrict access where appropriate, and document any refusal or partial erasure through the University's approved process.

## Incident response and sensitive data

UTG should designate an incident lead and legal/privacy contact, define applicable notification deadlines, and maintain an incident record for detection, classification, affected data, containment, recovery, evidence preservation, and notification decisions. The application does not currently implement a breach case-management system or determine whether notification is legally required.

The current platform handles academic records, identity/contact data, private submissions, messages, and device identifiers. Avoid collecting health, biometric, or other sensitive data unless UTG approves a specific purpose, lawful basis, access model, and safeguards. Under-18 users require an institution-approved age/guardian process where applicable; no age-verification workflow is implemented here.

## Database changes

The additive migration adds `Users.emailVerified`, defaulting existing users to verified, and records the privacy-security migration. New verification, security-event, privacy-request, and consent tables are created by the existing Sequelize model synchronization. No existing account or academic data is deleted. Review database migration output in a staging environment before production.

## Operational release checklist

- Configure and verify SMTP, `CLIENT_URL` (HTTPS), reset-delivery settings, JWT secret, and `PRIVACY_POLICY_VERSION`.
- Benchmark Argon2id in the deployed runtime and review login rate limits, email-delivery abuse, and monitoring alerts.
- Approve and publish the privacy notice, lawful bases, consent language, retention schedule, request deadlines, and incident-notification procedure with UTG legal/privacy leadership.
- Confirm provider contracts, data locations, subprocessors, access restrictions, backup/restore procedures, and cross-border safeguards.
- Test export coverage and permissions, email verification and reset delivery, account recovery, and privacy-request handling in a production-like environment.
- Restrict database and log access. Do not expose security-event records through general lecturer/audit routes.
