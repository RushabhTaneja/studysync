# StudySync — Android app (React Native / Expo)

The **participant** client for StudySync, built with React Native (Expo). It mirrors the participant
flows from the web app: sign in / register, accept consent, connect/disconnect **Dexcom CGM** and
**EHR (SMART-on-FHIR)** over OAuth, and view your own data. **Researchers use the web dashboard** —
the app blocks non-participant logins and points them there.

By default it talks to the **live backend** (`https://studysync-production-1228.up.railway.app`),
so it works against real data out of the box.

## Run it (Expo Go — no Android Studio needed)

1. Install the **Expo Go** app on your Android phone (Play Store).
2. From this folder:
   ```bash
   npm install
   npx expo start
   ```
3. Scan the QR code with Expo Go (phone on the same Wi‑Fi as your computer).

> Use `npx expo start --tunnel` if your phone and computer aren't on the same network.

## Run on an emulator / native build

- Android emulator (needs Android Studio + an AVD): `npx expo run:android`
- Production APK/AAB via EAS: `npm i -g eas-cli && eas build -p android` (needs a free Expo account).

## Configuration

- API base URL: `app.json → expo.extra.apiBaseUrl`, or set `EXPO_PUBLIC_API_BASE_URL` to point at a
  local backend (e.g. `http://<your-LAN-ip>:4000`) for development.
- Deep-link scheme: `studysync` (`app.json → expo.scheme`). The OAuth callback returns to the app
  via `studysync://oauth`, handled by `expo-web-browser`'s auth session.

## How the OAuth flow works on mobile

1. **Connect Dexcom/EHR** calls the backend `/api/connect/{provider}/start` with a `returnTo` deep
   link (`studysync://oauth`).
2. The provider's consent screen opens in an in-app browser (`WebBrowser.openAuthSessionAsync`).
3. After consent, the backend exchanges the code, ingests the data, and **redirects to the deep
   link**, which closes the browser and returns to the app. The app then refreshes (and briefly
   polls) the connection status. The `returnTo` redirect requires the backend on this branch
   (`react-native-app`); against an older backend the app falls back to status polling.

## Structure

- `App.tsx` — auth gating (login → consent → home).
- `src/api.ts` — typed API client; JWT stored in `expo-secure-store`.
- `src/auth.tsx` — auth context.
- `src/screens/` — `LoginScreen`, `ConsentScreen`, `HomeScreen`.
- `src/config.ts`, `src/theme.ts`.
