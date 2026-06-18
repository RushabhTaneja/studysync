import { Router } from "express";
import { query } from "../db/pool.js";
import { requireAuth } from "../auth/middleware.js";

export const participantRouter = Router();

/** A participant's own connection status across both data sources. */
participantRouter.get("/status", requireAuth("participant"), async (req, res) => {
  const id = req.user!.sub;
  const { rows: conns } = await query(
    `SELECT provider, status, connected_at, last_sync_at, last_data_at, scope
       FROM oauth_connections WHERE participant_account_id = $1`,
    [id]
  );
  const byProvider = Object.fromEntries(conns.map((c: any) => [c.provider, c]));
  res.json({
    dexcom: byProvider.dexcom ?? { status: "not_connected" },
    ehr: byProvider.ehr ?? { status: "not_connected" },
  });
});

/** A participant's own data summary (glucose volume + clinical record counts). */
participantRouter.get("/data", requireAuth("participant"), async (req, res) => {
  const id = req.user!.sub;
  const [glucose, latest, patient, conditions, meds, obs] = await Promise.all([
    query<{ count: string }>(`SELECT count(*) FROM glucose_egv WHERE participant_account_id=$1`, [id]),
    query<{ ts: Date; glucose_mg_dl: number }>(
      `SELECT ts, glucose_mg_dl FROM glucose_egv WHERE participant_account_id=$1 ORDER BY ts DESC LIMIT 1`,
      [id]
    ),
    query(`SELECT family_name, given_name, gender, birth_date FROM fhir_patient WHERE participant_account_id=$1`, [id]),
    query<{ count: string }>(`SELECT count(*) FROM fhir_condition WHERE participant_account_id=$1`, [id]),
    query<{ count: string }>(`SELECT count(*) FROM fhir_medication_request WHERE participant_account_id=$1`, [id]),
    query<{ count: string }>(`SELECT count(*) FROM fhir_observation WHERE participant_account_id=$1`, [id]),
  ]);
  res.json({
    glucose: {
      readings: Number(glucose.rows[0].count),
      latest: latest.rows[0] ?? null,
    },
    ehr: {
      patient: patient.rows[0] ?? null,
      conditions: Number(conditions.rows[0].count),
      medications: Number(meds.rows[0].count),
      observations: Number(obs.rows[0].count),
    },
  });
});
