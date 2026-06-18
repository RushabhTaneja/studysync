import { Router } from "express";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { requireAuth } from "../auth/middleware.js";
import { randomToken, pkcePair } from "../integrations/oauthUtil.js";
import * as dexcom from "../integrations/dexcom.js";
import * as smart from "../integrations/smartFhir.js";
import { ingestEhr } from "../integrations/fhirIngest.js";

export const connectRouter = Router();

const redirectToFrontend = (status: string, provider: string, reason?: string) =>
  `${config.frontendBaseUrl}/participant?${status}=${provider}` +
  (reason ? `&reason=${encodeURIComponent(reason)}` : "");

async function upsertConnection(row: {
  participantAccountId: string;
  provider: "dexcom" | "ehr";
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
  scope?: string | null;
  externalSubject?: string | null;
  fhirBaseUrl?: string | null;
  lastDataAt?: Date | null;
}) {
  const expiresAt = row.expiresIn ? new Date(Date.now() + row.expiresIn * 1000) : null;
  await query(
    `INSERT INTO oauth_connections
       (participant_account_id, provider, status, access_token, refresh_token, token_expires_at,
        scope, external_subject, fhir_base_url, connected_at, last_sync_at, last_data_at)
     VALUES ($1,$2,'connected',$3,$4,$5,$6,$7,$8, now(), now(), $9)
     ON CONFLICT (participant_account_id, provider) DO UPDATE SET
       status='connected', access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token,
       token_expires_at=EXCLUDED.token_expires_at, scope=EXCLUDED.scope,
       external_subject=EXCLUDED.external_subject, fhir_base_url=EXCLUDED.fhir_base_url,
       last_sync_at=now(), last_data_at=COALESCE(EXCLUDED.last_data_at, oauth_connections.last_data_at)`,
    [
      row.participantAccountId,
      row.provider,
      row.accessToken,
      row.refreshToken ?? null,
      expiresAt,
      row.scope ?? null,
      row.externalSubject ?? null,
      row.fhirBaseUrl ?? null,
      row.lastDataAt ?? null,
    ]
  );
}

// ─────────────────────────────── EHR (SMART-on-FHIR) ───────────────────────────────
connectRouter.post("/ehr/start", requireAuth("participant"), async (req, res) => {
  try {
    const disco = await smart.discoverSmart(config.smart.iss);
    const state = randomToken();
    const { verifier, challenge } = pkcePair();
    await query(
      `INSERT INTO oauth_state (state, participant_account_id, provider, code_verifier, token_url, fhir_base_url)
       VALUES ($1,$2,'ehr',$3,$4,$5)`,
      [state, req.user!.sub, verifier, disco.token_endpoint, config.smart.iss]
    );
    const authorizeUrl = smart.buildAuthorizeUrl({
      authorizationEndpoint: disco.authorization_endpoint,
      state,
      codeChallenge: challenge,
    });
    res.json({ authorizeUrl });
  } catch (err: any) {
    res.status(502).json({ error: `Could not start EHR connection: ${err.message}` });
  }
});

connectRouter.get("/ehr/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query as Record<string, string>;
  if (error) return res.redirect(redirectToFrontend("error", "ehr", error_description || error));
  try {
    const { rows } = await query<{
      participant_account_id: string;
      code_verifier: string;
      token_url: string;
      fhir_base_url: string;
    }>(`DELETE FROM oauth_state WHERE state = $1 AND provider = 'ehr' RETURNING *`, [state]);
    const st = rows[0];
    if (!st) throw new Error("Invalid or expired OAuth state");

    const token = await smart.exchangeCode({
      tokenUrl: st.token_url,
      code,
      codeVerifier: st.code_verifier,
    });
    if (!token.patient) throw new Error("Token response had no patient context");

    const ingest = await ingestEhr({
      participantAccountId: st.participant_account_id,
      fhirBase: st.fhir_base_url,
      accessToken: token.access_token,
      patientId: token.patient,
    });
    await upsertConnection({
      participantAccountId: st.participant_account_id,
      provider: "ehr",
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresIn: token.expires_in,
      scope: token.scope,
      externalSubject: token.patient,
      fhirBaseUrl: st.fhir_base_url,
      lastDataAt: ingest.lastDataAt,
    });
    res.redirect(redirectToFrontend("connected", "ehr"));
  } catch (err: any) {
    console.error("[ehr/callback]", err.message);
    res.redirect(redirectToFrontend("error", "ehr", err.message));
  }
});

// ─────────────────────────────── Dexcom CGM ───────────────────────────────
connectRouter.post("/dexcom/start", requireAuth("participant"), async (req, res) => {
  if (!config.dexcom.configured) {
    return res.status(503).json({
      error: "Dexcom integration is not configured (missing DEXCOM_CLIENT_ID/SECRET).",
    });
  }
  const state = randomToken();
  await query(
    `INSERT INTO oauth_state (state, participant_account_id, provider) VALUES ($1,$2,'dexcom')`,
    [state, req.user!.sub]
  );
  res.json({ authorizeUrl: dexcom.buildAuthorizeUrl(state) });
});

connectRouter.get("/dexcom/callback", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string>;
  if (error) return res.redirect(redirectToFrontend("error", "dexcom"));
  try {
    const { rows } = await query<{ participant_account_id: string }>(
      `DELETE FROM oauth_state WHERE state = $1 AND provider = 'dexcom' RETURNING participant_account_id`,
      [state]
    );
    const st = rows[0];
    if (!st) throw new Error("Invalid or expired OAuth state");

    const token = await dexcom.exchangeCode(code);
    // Mark connected and redirect immediately; the EGV backfill can be large, so pull it in
    // the background rather than holding the post-consent redirect open.
    await upsertConnection({
      participantAccountId: st.participant_account_id,
      provider: "dexcom",
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresIn: token.expires_in,
      scope: "offline_access",
    });
    res.redirect(redirectToFrontend("connected", "dexcom"));

    dexcom
      .ingestGlucose({ participantAccountId: st.participant_account_id, accessToken: token.access_token })
      .then(async (ingest) => {
        await query(
          `UPDATE oauth_connections SET last_sync_at=now(),
             last_data_at=COALESCE($3, last_data_at)
           WHERE participant_account_id=$1 AND provider=$2`,
          [st.participant_account_id, "dexcom", ingest.lastDataAt]
        );
        console.log(`[dexcom/callback] ingested ${ingest.ingested} EGVs for ${st.participant_account_id}`);
      })
      .catch((e) => console.error("[dexcom/ingest]", e.message));
  } catch (err: any) {
    console.error("[dexcom/callback]", err.message);
    res.redirect(redirectToFrontend("error", "dexcom", err.message));
  }
});

// ─────────────────────────────── Disconnect ───────────────────────────────
connectRouter.post("/:provider/disconnect", requireAuth("participant"), async (req, res) => {
  const provider = req.params.provider;
  if (provider !== "dexcom" && provider !== "ehr") {
    return res.status(400).json({ error: "Unknown provider" });
  }
  await query(
    `UPDATE oauth_connections
       SET status='disconnected', access_token=NULL, refresh_token=NULL, token_expires_at=NULL
     WHERE participant_account_id=$1 AND provider=$2`,
    [req.user!.sub, provider]
  );
  res.json({ ok: true });
});
