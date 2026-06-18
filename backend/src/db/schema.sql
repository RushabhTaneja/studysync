-- StudySync schema. Statements are separated by the marker line `-- @@break` so the
-- migrator can run them one at a time (TimescaleDB continuous aggregates and policies
-- cannot run inside a transaction block).

CREATE EXTENSION IF NOT EXISTS timescaledb;
-- @@break
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- @@break

-- ─────────────────────────── Accounts & RBAC ───────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('participant', 'researcher')),
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- @@break

-- Participant-specific profile (one row per participant account).
CREATE TABLE IF NOT EXISTS participants (
  account_id          uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  participant_code    text UNIQUE NOT NULL,          -- e.g. P01, used in the dashboard/chat
  consent_accepted_at timestamptz,                   -- null until consent accepted
  enrolled_at         timestamptz NOT NULL DEFAULT now()
);
-- @@break

-- ───────────────────── OAuth connections to data sources ─────────────────────
-- One row per (participant, provider). Holds the live tokens StudySync uses to pull data.
CREATE TABLE IF NOT EXISTS oauth_connections (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider               text NOT NULL CHECK (provider IN ('dexcom', 'ehr')),
  status                 text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected')),
  access_token           text,
  refresh_token          text,
  token_expires_at       timestamptz,
  scope                  text,
  external_subject       text,        -- Dexcom user id / FHIR patient id
  fhir_base_url          text,        -- EHR only
  connected_at           timestamptz NOT NULL DEFAULT now(),
  last_sync_at           timestamptz, -- last time we successfully pulled
  last_data_at           timestamptz, -- timestamp of the most recent data point pulled
  UNIQUE (participant_account_id, provider)
);
-- @@break

-- Short-lived OAuth handshake state (CSRF state + PKCE verifier), keyed by `state`.
CREATE TABLE IF NOT EXISTS oauth_state (
  state                  text PRIMARY KEY,
  participant_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider               text NOT NULL CHECK (provider IN ('dexcom', 'ehr')),
  code_verifier          text,        -- PKCE (EHR)
  token_url              text,        -- discovered at launch time (EHR)
  fhir_base_url          text,        -- EHR
  created_at             timestamptz NOT NULL DEFAULT now()
);
-- @@break
-- Optional deep link the callback redirects to instead of the web app (mobile clients).
ALTER TABLE oauth_state ADD COLUMN IF NOT EXISTS return_to text;
-- @@break

-- ─────────────────────────── CGM time-series ───────────────────────────
-- High-frequency glucose readings (Dexcom EGVs). Hypertable, partitioned on ts.
CREATE TABLE IF NOT EXISTS glucose_egv (
  participant_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ts                     timestamptz NOT NULL,
  glucose_mg_dl          integer,
  trend                  text,
  trend_rate             real,
  transmitter_id         text,
  display_device         text,
  source                 text NOT NULL DEFAULT 'dexcom',
  UNIQUE (participant_account_id, ts)
);
-- @@break
SELECT create_hypertable('glucose_egv', 'ts', if_not_exists => TRUE, migrate_data => TRUE);
-- @@break

-- ───────────────────── Flattened FHIR (EHR) tables ─────────────────────
-- One demographics row per participant.
CREATE TABLE IF NOT EXISTS fhir_patient (
  participant_account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  fhir_patient_id text,
  family_name     text,
  given_name      text,
  gender          text,
  birth_date      date,
  race            text,
  ethnicity       text,
  raw             jsonb
);
-- @@break
CREATE TABLE IF NOT EXISTS fhir_condition (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  fhir_id         text,
  code_system     text,
  code            text,
  display         text,
  clinical_status text,
  onset_date      date,
  recorded_date   date,
  raw             jsonb,
  UNIQUE (participant_account_id, fhir_id)
);
-- @@break
CREATE TABLE IF NOT EXISTS fhir_medication_request (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  fhir_id      text,
  code_system  text,
  code         text,
  display      text,        -- medication name
  status       text,
  intent       text,
  authored_on  timestamptz,
  raw          jsonb,
  UNIQUE (participant_account_id, fhir_id)
);
-- @@break
CREATE TABLE IF NOT EXISTS fhir_observation (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  fhir_id        text,
  category       text,
  code_system    text,
  code           text,        -- e.g. LOINC
  display        text,
  value_quantity numeric,
  value_unit     text,
  value_string   text,
  effective_time timestamptz,
  status         text,
  raw            jsonb,
  UNIQUE (participant_account_id, fhir_id)
);
-- @@break

-- ──────────────── Continuous aggregate for wear adherence ────────────────
-- Hourly reading counts per participant. A Dexcom sensor produces ~12 readings/hour
-- (one every 5 min) when worn, so reading_count is a direct adherence signal.
CREATE MATERIALIZED VIEW IF NOT EXISTS cagg_glucose_hourly
WITH (timescaledb.continuous) AS
SELECT
  participant_account_id,
  time_bucket('1 hour', ts) AS bucket,
  count(*)            AS reading_count,
  avg(glucose_mg_dl)  AS avg_glucose,
  min(glucose_mg_dl)  AS min_glucose,
  max(glucose_mg_dl)  AS max_glucose
FROM glucose_egv
GROUP BY participant_account_id, time_bucket('1 hour', ts)
WITH NO DATA;
-- @@break
SELECT add_continuous_aggregate_policy('cagg_glucose_hourly',
  start_offset => INTERVAL '7 days',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE);
-- @@break

-- Index to speed up the common "latest readings for a participant" access pattern.
CREATE INDEX IF NOT EXISTS idx_glucose_participant_ts
  ON glucose_egv (participant_account_id, ts DESC);
-- @@break
CREATE INDEX IF NOT EXISTS idx_observation_participant_code
  ON fhir_observation (participant_account_id, code);
