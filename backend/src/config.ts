import dotenv from "dotenv";
dotenv.config();

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
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
    iss: process.env.SMART_FHIR_ISS ?? "https://launch.smarthealthit.org/v/r4/fhir",
    clientId: process.env.SMART_CLIENT_ID ?? "studysync-web",
  },

  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
};

export const redirectUri = (provider: "dexcom" | "ehr") =>
  `${config.backendBaseUrl}/api/connect/${provider}/callback`;
