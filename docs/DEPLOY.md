# Deploying StudySync to Railway

The app deploys as **one Railway service**: the Express backend serves both the API (`/api/*`)
and the built React app (everything else), against your existing **Timescale Cloud** database.
Because the hosted app reuses the same `DATABASE_URL` you already migrated and seeded, the genuine
data (P01's real Dexcom + EHR, seeded logins) is live immediately — nothing to re-run.

## What's already wired for deploy

- Root `package.json` — `build` installs+builds frontend then backend; `start` runs the backend.
- `railway.json` — tells Railway to use those commands (Nixpacks).
- `backend/src/index.ts` — serves `frontend/dist` statically with an SPA fallback when present.
- Secrets stay out of git (`.env` is gitignored); you set them as Railway variables.

## Step 1 — Install the Railway CLI and log in

```bash
npm i -g @railway/cli
railway login          # opens a browser to authenticate
```

> In Claude Code you can run these yourself by typing `! railway login` etc.

## Step 2 — Create the project and link it

From the repo root (`studysync/`):

```bash
railway init           # creates a new project; give it a name e.g. "studysync"
```

## Step 3 — Set environment variables

Set these on the service (dashboard → Variables, or `railway variables --set 'KEY=VALUE'`).
**Do not set `PORT`** — Railway injects it and the app reads it automatically.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | your Timescale Cloud connection string (the same one in local `.env`) |
| `JWT_SECRET` | a long random string (e.g. `openssl rand -hex 32`) |
| `DEXCOM_CLIENT_ID` | your Dexcom sandbox client id |
| `DEXCOM_CLIENT_SECRET` | your Dexcom sandbox client secret |
| `DEXCOM_BASE_URL` | `https://sandbox-api.dexcom.com` |
| `SMART_FHIR_ISS` | `https://launch.smarthealthit.org/v/r4/fhir` |
| `SMART_CLIENT_ID` | `studysync-web` |
| `ANTHROPIC_API_KEY` | your Anthropic key (for the insights chat) |
| `ANTHROPIC_MODEL` | `claude-opus-4-8` |
| `BACKEND_BASE_URL` | *(set after Step 5)* `https://<your-app>.up.railway.app` |
| `FRONTEND_BASE_URL` | *(set after Step 5)* same as `BACKEND_BASE_URL` |

## Step 4 — Deploy

```bash
railway up             # uploads the repo and builds it on Railway
```

Watch the build logs: it runs `npm run build` (frontend + backend) then `npm run start`.

## Step 5 — Generate a domain, then point the app at it

```bash
railway domain         # creates https://<your-app>.up.railway.app
```

Now set **both** `BACKEND_BASE_URL` and `FRONTEND_BASE_URL` to that URL (Step 3 table), and
**redeploy** (`railway up`, or it redeploys automatically on variable change). This matters because
the OAuth redirect URIs are derived from `BACKEND_BASE_URL`.

## Step 6 — Register the production redirect URI with Dexcom

In the Dexcom developer portal, add this redirect URI to your app (keep the localhost one too):

```
https://<your-app>.up.railway.app/api/connect/dexcom/callback
```

SMART-on-FHIR needs no registration (its launcher accepts any redirect).

## Step 7 — Verify

- Visit `https://<your-app>.up.railway.app/api/health` → `{ ok: true, dexcomConfigured: true, chatConfigured: true, ... }`
- Open the app, sign in as the researcher (`researcher@studysync.dev` / `researcher123`) → cohort, charts, and insights chat should work on the genuine data.
- Sign in as the participant and re-run **Connect Dexcom / Connect EHR** against the production URL to confirm the live OAuth round-trip on the hosted domain.

## Alternative: deploy from GitHub

Instead of the CLI you can push this repo to GitHub and in Railway choose **New Project → Deploy
from GitHub repo**. Railway auto-detects `railway.json` and redeploys on every push. Set the same
variables in Step 3.

## Notes

- The build needs Node 20+ (pinned via `engines` in root `package.json`).
- If you rotate the Timescale Cloud password, update `DATABASE_URL` and redeploy.
- The chat is optional at runtime — without `ANTHROPIC_API_KEY` the chat endpoint returns 503 and
  the rest of the app is unaffected.
```
