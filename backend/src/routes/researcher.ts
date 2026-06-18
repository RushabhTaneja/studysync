import { Router } from "express";
import { query } from "../db/pool.js";
import { requireAuth } from "../auth/middleware.js";
import {
  glucoseMetrics,
  ambulatoryProfile,
  dailyAdherence,
  EXPECTED_READINGS_PER_HOUR,
} from "../services/cgmMetrics.js";

export const researcherRouter = Router();

// All researcher routes require the researcher role (RBAC enforced here).
researcherRouter.use(requireAuth("researcher"));

async function resolveParticipant(code: string): Promise<{ accountId: string; name: string } | null> {
  const { rows } = await query<{ account_id: string; display_name: string }>(
    `SELECT p.account_id, a.display_name
       FROM participants p JOIN accounts a ON a.id = p.account_id
      WHERE p.participant_code = $1`,
    [code]
  );
  return rows[0] ? { accountId: rows[0].account_id, name: rows[0].display_name } : null;
}

/**
 * Resolve an N-day analytics window anchored to the participant's most recent reading.
 * CGM sandboxes serve a fixed historical window, so anchoring to "now" would show nothing;
 * we anchor to the latest available data so metrics always reflect the real series.
 */
async function windowFor(accountId: string, days: number): Promise<{ start: Date; end: Date }> {
  const { rows } = await query<{ m: Date | null }>(
    `SELECT max(ts) AS m FROM glucose_egv WHERE participant_account_id = $1`,
    [accountId]
  );
  const latest = rows[0]?.m ? new Date(rows[0].m) : new Date();
  const end = new Date(latest.getTime() + 1000); // make the window inclusive of the last reading
  const start = new Date(end.getTime() - days * 24 * 3600 * 1000);
  return { start, end };
}

/** Cohort overview: per participant, connected sources, data flow, last data point. */
researcherRouter.get("/cohort", async (_req, res) => {
  const { rows } = await query<any>(
    `SELECT
        p.participant_code,
        a.display_name,
        p.consent_accepted_at,
        MAX(CASE WHEN c.provider='dexcom' AND c.status='connected' THEN 1 ELSE 0 END)::bool AS dexcom_connected,
        MAX(CASE WHEN c.provider='ehr'    AND c.status='connected' THEN 1 ELSE 0 END)::bool AS ehr_connected,
        MAX(CASE WHEN c.provider='dexcom' THEN c.last_data_at END) AS dexcom_last_data,
        MAX(CASE WHEN c.provider='ehr'    THEN c.last_data_at END) AS ehr_last_data,
        (SELECT count(*) FROM glucose_egv g WHERE g.participant_account_id = p.account_id) AS glucose_readings,
        (SELECT max(ts) FROM glucose_egv g WHERE g.participant_account_id = p.account_id) AS last_glucose_ts
      FROM participants p
      JOIN accounts a ON a.id = p.account_id
      LEFT JOIN oauth_connections c ON c.participant_account_id = p.account_id
      GROUP BY p.participant_code, a.display_name, p.consent_accepted_at, p.account_id
      ORDER BY p.participant_code`
  );
  const cohort = rows.map((r) => {
    const lastGlucose = r.last_glucose_ts ? new Date(r.last_glucose_ts) : null;
    // "Data flowing" = a glucose reading within the last 24h (sandbox data is fixed-window,
    // so we also report the absolute last-data timestamp for context).
    const flowing = lastGlucose ? Date.now() - lastGlucose.getTime() < 24 * 3600 * 1000 : false;
    return {
      participantCode: r.participant_code,
      name: r.display_name,
      consented: !!r.consent_accepted_at,
      sources: {
        dexcom: { connected: r.dexcom_connected, lastData: r.dexcom_last_data },
        ehr: { connected: r.ehr_connected, lastData: r.ehr_last_data },
      },
      glucoseReadings: Number(r.glucose_readings),
      lastGlucoseTs: r.last_glucose_ts,
      dataFlowing: flowing,
    };
  });
  res.json({ cohort });
});

/** Detailed view for one participant: glucose metrics + clinical record summary. */
researcherRouter.get("/participant/:code", async (req, res) => {
  const p = await resolveParticipant(req.params.code);
  if (!p) return res.status(404).json({ error: "Participant not found" });
  const days = Number(req.query.days ?? 30);
  const { start, end } = await windowFor(p.accountId, days);

  const [metrics, conditions, meds, observations, patient] = await Promise.all([
    glucoseMetrics(p.accountId, start, end),
    query(`SELECT display, clinical_status, onset_date FROM fhir_condition WHERE participant_account_id=$1 ORDER BY onset_date DESC NULLS LAST`, [p.accountId]),
    query(`SELECT display, status, authored_on FROM fhir_medication_request WHERE participant_account_id=$1 ORDER BY authored_on DESC NULLS LAST`, [p.accountId]),
    query(`SELECT code, display, value_quantity, value_unit, effective_time FROM fhir_observation WHERE participant_account_id=$1 ORDER BY effective_time DESC NULLS LAST LIMIT 50`, [p.accountId]),
    query(`SELECT family_name, given_name, gender, birth_date, race, ethnicity FROM fhir_patient WHERE participant_account_id=$1`, [p.accountId]),
  ]);

  res.json({
    participantCode: req.params.code,
    name: p.name,
    windowDays: days,
    glucose: metrics,
    ehr: {
      patient: patient.rows[0] ?? null,
      conditions: conditions.rows,
      medications: meds.rows,
      observations: observations.rows,
    },
  });
});

/** Daily wear-hours / volume for the adherence heatmap + streaks. */
researcherRouter.get("/participant/:code/adherence", async (req, res) => {
  const p = await resolveParticipant(req.params.code);
  if (!p) return res.status(404).json({ error: "Participant not found" });
  const days = Number(req.query.days ?? 30);
  const { start, end } = await windowFor(p.accountId, days);
  const series = await dailyAdherence(p.accountId, start, end);
  res.json({ participantCode: req.params.code, expectedReadingsPerHour: EXPECTED_READINGS_PER_HOUR, days: series });
});

/** Ambulatory glucose profile (typical day percentile curve). */
researcherRouter.get("/participant/:code/agp", async (req, res) => {
  const p = await resolveParticipant(req.params.code);
  if (!p) return res.status(404).json({ error: "Participant not found" });
  const days = Number(req.query.days ?? 30);
  const { start, end } = await windowFor(p.accountId, days);
  const profile = await ambulatoryProfile(p.accountId, start, end);
  res.json({ participantCode: req.params.code, profile });
});

/** Non-adherence alerts: participants with low recent wear-time. */
researcherRouter.get("/alerts", async (_req, res) => {
  const { rows } = await query<any>(
    `WITH latest AS (
       SELECT participant_account_id, max(bucket) AS maxb
         FROM cagg_glucose_hourly GROUP BY participant_account_id
     ),
     recent AS (
       SELECT c.participant_account_id,
              count(*) FILTER (WHERE c.reading_count >= 6) AS worn_hours
         FROM cagg_glucose_hourly c
         JOIN latest l ON l.participant_account_id = c.participant_account_id
        WHERE c.bucket > l.maxb - interval '7 days'
        GROUP BY c.participant_account_id
     )
     SELECT p.participant_code, a.display_name,
            COALESCE(r.worn_hours, 0) AS worn_hours_7d
       FROM participants p
       JOIN accounts a ON a.id = p.account_id
       JOIN oauth_connections c ON c.participant_account_id = p.account_id
            AND c.provider='dexcom' AND c.status='connected'
       LEFT JOIN recent r ON r.participant_account_id = p.account_id
      WHERE COALESCE(r.worn_hours, 0) < (7 * 24 * 0.7)
      ORDER BY worn_hours_7d ASC`
  );
  const alerts = rows.map((r) => ({
    participantCode: r.participant_code,
    name: r.display_name,
    wornHours7d: Number(r.worn_hours_7d),
    expectedHours7d: 7 * 24,
    adherencePct: Math.round((Number(r.worn_hours_7d) / (7 * 24)) * 1000) / 10,
  }));
  res.json({ alerts, thresholdPct: 70 });
});

/** Export a participant's full data as a JSON file. */
researcherRouter.get("/participant/:code/export", async (req, res) => {
  const p = await resolveParticipant(req.params.code);
  if (!p) return res.status(404).json({ error: "Participant not found" });

  const [glucose, patient, conditions, meds, observations] = await Promise.all([
    query(`SELECT ts, glucose_mg_dl, trend, trend_rate FROM glucose_egv WHERE participant_account_id=$1 ORDER BY ts`, [p.accountId]),
    query(`SELECT * FROM fhir_patient WHERE participant_account_id=$1`, [p.accountId]),
    query(`SELECT fhir_id, code_system, code, display, clinical_status, onset_date, recorded_date FROM fhir_condition WHERE participant_account_id=$1`, [p.accountId]),
    query(`SELECT fhir_id, code_system, code, display, status, intent, authored_on FROM fhir_medication_request WHERE participant_account_id=$1`, [p.accountId]),
    query(`SELECT fhir_id, category, code_system, code, display, value_quantity, value_unit, value_string, effective_time, status FROM fhir_observation WHERE participant_account_id=$1`, [p.accountId]),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    participant: { code: req.params.code, name: p.name },
    cgm: { source: "dexcom", readingCount: glucose.rowCount, readings: glucose.rows },
    ehr: {
      source: "smart-on-fhir",
      patient: patient.rows[0] ?? null,
      conditions: conditions.rows,
      medications: meds.rows,
      observations: observations.rows,
    },
  };
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${req.params.code}-export.json"`);
  res.send(JSON.stringify(payload, null, 2));
});
