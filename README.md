# StudySync — Wearable Data Platform (MVP)

A scaled-down wearable data platform for the Snyder Lab take-home challenge. Participants
connect two real health-data sources over OAuth 2.0 — **Dexcom CGM** (glucose time-series) and
their **EHR via SMART-on-FHIR** (clinical record) — and researchers monitor the cohort, view
device-wear adherence, export data, and ask natural-language questions over both sources.

> **Decided loudly (MVP scope):** The challenge specifies an *Android* participant client. For
> this MVP we build a **web participant app** instead (same flows: sign-in, consent, connect/
> disconnect sources, see own data), to get a genuine end-to-end slice working by the deadline.
> The two OAuth integrations, RBAC account system, and TimescaleDB are kept real per the brief.

## Architecture

```
React/Vite web app ──► Node/Express API ──► TimescaleDB (Timescale Cloud)
  (participant +          (auth/RBAC,            - accounts, oauth_connections
   researcher roles)       OAuth orchestration,   - glucose_egv (hypertable)
                           ingestion, metrics)    - flattened FHIR tables
                              │   │
                  ┌───────────┘   └────────────┐
          Dexcom CGM sandbox          SMART-on-FHIR sandbox
       (OAuth2 auth-code, EGVs)   (OAuth2 auth-code + PKCE, FHIR R4)
```

See `docs/` for the architecture and ER diagrams and the design writeup.

## Repo layout

- `backend/` — Node + Express + TypeScript API, TimescaleDB schema/migrations, OAuth integrations.
- `frontend/` — React + Vite + TypeScript web app (participant + researcher).
- `docs/` — design writeup and diagrams.

## Run locally

Prereqs: Node 20+, a TimescaleDB connection string (free Timescale Cloud trial works).

```bash
# 1. Backend
cd backend
cp .env.example .env        # fill in DATABASE_URL (+ Dexcom creds when available)
npm install
npm run migrate             # create schema + hypertable + continuous aggregates
npm run seed                # seed researcher + participant logins
npm run dev                 # http://localhost:4000

# 2. Frontend
cd ../frontend
npm install
npm run dev                 # http://localhost:5173
```

## Seeded logins

See `backend/src/db/seed.ts` (printed on seed). One researcher, one participant.

## Data sources — both genuine

Both integrations run the real OAuth 2.0 handshake against their sandbox and pull live data
(synthetic patients, real authorization — no mocked data in the running system):

- **Dexcom CGM** — OAuth2 authorization-code; pulls the EGV glucose time-series into the hypertable.
  Requires a registered sandbox app (`DEXCOM_CLIENT_ID/SECRET`) and its redirect URI set to
  `${BACKEND_BASE_URL}/api/connect/dexcom/callback`.
- **EHR via SMART-on-FHIR** — OAuth2 authorization-code + PKCE against the public SMART Health IT
  launcher (no registration); pulls Patient / Condition / MedicationRequest / Observation.

> The Dexcom sandbox serves a *fixed historical* data window, so the dashboard anchors its
> metrics/adherence/AGP windows to each participant's latest reading rather than to "today."

`npm run seed:demo-glucose` can populate clearly-labeled synthetic CGM rows for local development
without Dexcom credentials; `npm run clear-mock` removes them so only genuine data remains.

## Status

Both data-source integrations verified end-to-end against live sandboxes; researcher dashboard,
adherence (continuous aggregate), and JSON export working on real data. Remaining: NL insights
chat and live hosting — see the commit history.
