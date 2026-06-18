import { config, redirectUri } from "../config.js";
import { query } from "../db/pool.js";

// Dexcom uses OAuth 2.0 authorization-code (confidential client, no PKCE).
const SCOPE = "offline_access";

export function buildAuthorizeUrl(state: string): string {
  const u = new URL(`${config.dexcom.baseUrl}/v2/oauth2/login`);
  u.searchParams.set("client_id", config.dexcom.clientId);
  u.searchParams.set("redirect_uri", redirectUri("dexcom"));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPE);
  u.searchParams.set("state", state);
  return u.toString();
}

export interface DexcomToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

async function tokenRequest(body: URLSearchParams): Promise<DexcomToken> {
  const res = await fetch(`${config.dexcom.baseUrl}/v2/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`Dexcom token request failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as DexcomToken;
}

export function exchangeCode(code: string): Promise<DexcomToken> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri("dexcom"),
      client_id: config.dexcom.clientId,
      client_secret: config.dexcom.clientSecret,
    })
  );
}

export function refreshToken(refresh: string): Promise<DexcomToken> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      redirect_uri: redirectUri("dexcom"),
      client_id: config.dexcom.clientId,
      client_secret: config.dexcom.clientSecret,
    })
  );
}

/** Available data window for the connected user (sandbox returns a fixed range). */
async function dataRange(accessToken: string): Promise<{ start: string; end: string } | null> {
  const res = await fetch(`${config.dexcom.baseUrl}/v3/users/self/dataRange`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json: any = await res.json();
  const start = json?.egvs?.start?.systemTime;
  const end = json?.egvs?.end?.systemTime;
  return start && end ? { start, end } : null;
}

/** Dexcom requires windows <= 90 days; chunk the range. */
function* windows(start: Date, end: Date): Generator<[Date, Date]> {
  const span = 30 * 24 * 3600 * 1000;
  let cursor = start.getTime();
  while (cursor < end.getTime()) {
    const next = Math.min(cursor + span, end.getTime());
    yield [new Date(cursor), new Date(next)];
    cursor = next;
  }
}

const fmt = (d: Date) => d.toISOString().slice(0, 19); // Dexcom wants YYYY-MM-DDThh:mm:ss

/**
 * Pull the participant's EGV (glucose) time-series and ingest into the hypertable.
 * Returns count ingested and the most recent reading timestamp.
 */
export async function ingestGlucose(opts: {
  participantAccountId: string;
  accessToken: string;
}): Promise<{ ingested: number; lastDataAt: Date | null }> {
  const { participantAccountId, accessToken } = opts;
  const range = await dataRange(accessToken);
  if (!range) return { ingested: 0, lastDataAt: null };

  let ingested = 0;
  let lastDataAt: Date | null = null;

  for (const [from, to] of windows(new Date(range.start), new Date(range.end))) {
    const u = new URL(`${config.dexcom.baseUrl}/v3/users/self/egvs`);
    u.searchParams.set("startDate", fmt(from));
    u.searchParams.set("endDate", fmt(to));
    const res = await fetch(u, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Dexcom EGV fetch failed (${res.status}): ${await res.text()}`);
    const json: any = await res.json();
    const records: any[] = json.records ?? json.egvs ?? [];

    for (const r of records) {
      const tsStr: string = r.systemTime ?? r.displayTime;
      if (!tsStr || r.value == null) continue;
      const ts = new Date(tsStr.endsWith("Z") ? tsStr : tsStr + "Z");
      await query(
        `INSERT INTO glucose_egv (participant_account_id, ts, glucose_mg_dl, trend, trend_rate, transmitter_id, display_device, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'dexcom')
         ON CONFLICT (participant_account_id, ts) DO NOTHING`,
        [
          participantAccountId,
          ts.toISOString(),
          Math.round(r.value),
          r.trend ?? null,
          r.trendRate ?? null,
          r.transmitterId ?? null,
          r.displayDevice ?? null,
        ]
      );
      ingested++;
      if (!lastDataAt || ts > lastDataAt) lastDataAt = ts;
    }
  }
  return { ingested, lastDataAt };
}
