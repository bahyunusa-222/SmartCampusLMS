# SmartCampus mobile notifications

This Expo companion app targets Android and iOS. Students and lecturers sign
in with their existing SmartCampus email/password account, then opt in to
device notifications. The app uses Expo Push Service; it does not send SMS or
use a student's phone number. Create accounts through the existing web
registration experience before signing in to the companion app.

## Local development

1. Install the root project's backend dependencies and the mobile dependencies
   with `npm install` in this directory.
2. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to the backend
   origin. For a physical device on local Wi-Fi, use the computer's LAN IP,
   not `localhost`.
3. Create or link an Expo EAS project, then set its project ID as
   `EXPO_PUBLIC_EAS_PROJECT_ID` in the local environment and the EAS build
   environment. The ID is public app configuration, not a secret.
4. Configure Android FCM v1 credentials and an Apple APNs key in the EAS
   project's credentials. Push delivery requires those platform credentials.
5. Build and install a development client on a physical Android or iOS device:

   ```powershell
   npx eas-cli login
   npx eas-cli init
   npx eas-cli build --profile development --platform android
   npx eas-cli build --profile development --platform ios
   npx expo start --dev-client
   ```

   Remote push notifications do not work in Expo Go; use an installed
   development or production build on a physical device.

The backend registers a device token only for the authenticated account.
Notifications are queued in PostgreSQL first and pushed after the transaction
commits. A failed push does not undo the LMS event or its in-app notification.
Users can disable push in the app, and signing out unregisters that device
before clearing its local credentials.

## Production setup

Set `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_EAS_PROJECT_ID` in the EAS build
environment. Configure platform push credentials in the Expo project's
credentials settings. No Expo access token, APNs key, FCM service-account key,
or phone number is required by the backend at runtime; only Expo Push Tokens
are stored in the `NotificationDevices` table.

The backend creates that table through its existing Sequelize model
synchronization on startup. Push registration endpoints are authenticated:
`POST /api/notifications/devices` and `DELETE /api/notifications/devices`.
