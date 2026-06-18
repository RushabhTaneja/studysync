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

## Status

Work in progress — see the task list / commit history.
