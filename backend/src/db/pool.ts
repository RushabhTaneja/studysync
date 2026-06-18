import pg from "pg";
import { config } from "../config.js";

if (!config.databaseUrl) {
  console.warn(
    "[db] DATABASE_URL is not set. Set it to your TimescaleDB connection string in backend/.env"
  );
}

// Timescale Cloud requires SSL. We accept its managed cert (sslmode=require in the URL),
// but node-postgres needs rejectUnauthorized:false unless the CA is provided.
const needsSsl = /sslmode=require/.test(config.databaseUrl) || /tsdb\.cloud\.timescale\.com/.test(config.databaseUrl);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}
