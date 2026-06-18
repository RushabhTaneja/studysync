import dotenv from "dotenv";
dotenv.config();

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

// The SMART Launcher (smart-launcher-v2) encodes launch context as a base64url JSON array in a
// `/sim/{...}/` path segment. A bare `/v/r4/fhir` base has no launch context, so its standalone
// authorize endpoint fails with "Invalid launch options". We inject a provider-standalone context
// (launch_type index 2) so the launcher shows a patient picker and returns patient context.
// Field order per the launcher's codec: [launch_type, patient, provider, encounter, skip_login,
// skip_auth, sim_ehr, scope, redirect_uris, client_id, client_secret, auth_error, jwks_url, jwks,
// client_type, pkce, fhir_server].
function smartLaunchSim(launchType = 2): string {
  const arr = [launchType, "", "", "AUTO", 0, 0, 0, "", "", "", "", "", "", "", 0, 0, ""];
  return Buffer.from(JSON.stringify(arr), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function resolveSmartIss(base: string): string {
  if (base.includes("/sim/")) return base; // caller already provided launch context
  return base.replace(/\/fhir\/?$/, `/sim/${smartLaunchSim()}/fhir`);
}

export const config = {
  port: parseInt(process.env.PORT ?? "4000", 10),
  nodeEnv: process.env.NODE_ENV ?? "development",
  backendBaseUrl: req("BACKEND_BASE_URL", "http://localhost:4000"),
  frontendBaseUrl: req("FRONTEND_BASE_URL", "http://localhost:5173"),

  jwtSecret: req("JWT_SECRET", "dev-only-change-me"),

  databaseUrl: process.env.DATABASE_URL ?? "",

  dexcom: {
    clientId: process.env.DEXCOM_CLIENT_ID ?? "",
    clientSecret: process.env.DEXCOM_CLIENT_SECRET ?? "",
    baseUrl: process.env.DEXCOM_BASE_URL ?? "https://sandbox-api.dexcom.com",
    get configured() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },

  smart: {
    // Launch-enabled FHIR base (carries provider-standalone launch context for the sandbox).
    iss: resolveSmartIss(process.env.SMART_FHIR_ISS ?? "https://launch.smarthealthit.org/v/r4/fhir"),
    clientId: process.env.SMART_CLIENT_ID ?? "studysync-web",
  },

  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
};

export const redirectUri = (provider: "dexcom" | "ehr") =>
  `${config.backendBaseUrl}/api/connect/${provider}/callback`;
