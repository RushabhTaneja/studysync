import { config, redirectUri } from "../config.js";

// Scopes from the challenge brief.
const SCOPES = [
  "launch/patient",
  "openid",
  "fhirUser",
  "offline_access",
  "patient/Patient.read",
  "patient/Observation.read",
  "patient/Condition.read",
  "patient/MedicationRequest.read",
].join(" ");

interface SmartConfig {
  authorization_endpoint: string;
  token_endpoint: string;
}

/** Read the SMART discovery document from the FHIR base. */
export async function discoverSmart(iss: string): Promise<SmartConfig> {
  const url = `${iss.replace(/\/$/, "")}/.well-known/smart-configuration`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`SMART discovery failed (${res.status}) at ${url}`);
  const json = (await res.json()) as SmartConfig;
  if (!json.authorization_endpoint || !json.token_endpoint) {
    throw new Error("SMART discovery doc missing authorization/token endpoints");
  }
  return json;
}

export function buildAuthorizeUrl(opts: {
  authorizationEndpoint: string;
  state: string;
  codeChallenge: string;
}): string {
  const u = new URL(opts.authorizationEndpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", config.smart.clientId);
  u.searchParams.set("redirect_uri", redirectUri("ehr"));
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("state", opts.state);
  u.searchParams.set("aud", config.smart.iss);
  u.searchParams.set("code_challenge", opts.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

export interface SmartTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  patient?: string; // selected patient id (launch/patient context)
  token_type: string;
}

export async function exchangeCode(opts: {
  tokenUrl: string;
  code: string;
  codeVerifier: string;
}): Promise<SmartTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: redirectUri("ehr"),
    client_id: config.smart.clientId, // public client (PKCE), no secret
    code_verifier: opts.codeVerifier,
  });
  const res = await fetch(opts.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`SMART token exchange failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as SmartTokenResponse;
}

export async function refreshToken(opts: {
  tokenUrl: string;
  refreshToken: string;
}): Promise<SmartTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: opts.refreshToken,
    client_id: config.smart.clientId,
  });
  const res = await fetch(opts.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`SMART token refresh failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as SmartTokenResponse;
}

/** Fetch all pages of a FHIR search bundle, following `next` links. */
export async function fhirSearchAll(
  fhirBase: string,
  accessToken: string,
  path: string
): Promise<any[]> {
  const resources: any[] = [];
  let url: string | null = `${fhirBase.replace(/\/$/, "")}/${path}`;
  let guard = 0;
  while (url && guard++ < 20) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/fhir+json" },
    });
    if (!res.ok) throw new Error(`FHIR fetch failed (${res.status}) for ${url}: ${await res.text()}`);
    const bundle: any = await res.json();
    for (const entry of bundle.entry ?? []) {
      if (entry.resource) resources.push(entry.resource);
    }
    const next = (bundle.link ?? []).find((l: any) => l.relation === "next");
    url = next?.url ?? null;
  }
  return resources;
}

export async function fhirRead(
  fhirBase: string,
  accessToken: string,
  path: string
): Promise<any> {
  const res = await fetch(`${fhirBase.replace(/\/$/, "")}/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/fhir+json" },
  });
  if (!res.ok) throw new Error(`FHIR read failed (${res.status}) for ${path}: ${await res.text()}`);
  return res.json();
}

export { SCOPES as SMART_SCOPES };
