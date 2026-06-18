import pg from "pg";
import { config } from "../config.js";

if (!config.databaseUrl) {
  console.warn(
    "[db] DATABASE_URL is not set. Set it to your TimescaleDB connection string in backend/.env"
  );
}

// Timescale Cloud requires SSL but presents a cert chain Node doesn't trust by default.
// Newer pg-connection-string treats `sslmode=require` as verify-full, which rejects it, so we
// strip sslmode from the URL and set SSL ourselves (encrypt, don't verify the managed cert).
const needsSsl =
  /sslmode=/.test(config.databaseUrl) || /tsdb\.cloud\.timescale\.com/.test(config.databaseUrl);
const connectionString = config.databaseUrl.replace(/([?&])sslmode=[^&]*(&|$)/, "$1").replace(/[?&]$/, "");

export const pool = new pg.Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}
