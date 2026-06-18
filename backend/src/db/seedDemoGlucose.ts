import { pool, query } from "./pool.js";

/**
 * DEV-ONLY synthetic CGM generator.
 *
 * This is NOT a Dexcom connection and makes no "genuine integration" claim — it exists
 * purely so the adherence / time-in-range / AGP analytics can be developed and demoed
 * locally while real Dexcom sandbox credentials are pending. The genuine ingestion path
 * is src/integrations/dexcom.ts. Rows written here are tagged source='synthetic-dev'.
 *
 * Usage: npm run seed:demo-glucose -- [participantCode=P01] [days=30]
 */
async function main() {
  const code = process.argv[2] ?? "P01";
  const days = Number(process.argv[3] ?? 30);

  const { rows } = await query<{ account_id: string }>(
    `SELECT account_id FROM participants WHERE participant_code = $1`,
    [code]
  );
  if (!rows[0]) throw new Error(`No participant with code ${code} (run npm run seed first)`);
  const accountId = rows[0].account_id;

  const now = Date.now();
  const start = now - days * 24 * 3600 * 1000;
  const stepMs = 5 * 60 * 1000; // one reading every 5 minutes when worn

  let count = 0;
  const batch: any[] = [];
  for (let t = start; t < now; t += stepMs) {
    const d = new Date(t);
    const hour = d.getHours() + d.getMinutes() / 60;

    // Simulate realistic wear gaps: ~85% adherence, with occasional multi-hour gaps.
    const dayIndex = Math.floor((t - start) / (24 * 3600 * 1000));
    const gapDay = dayIndex % 9 === 8; // a poorly-worn day roughly once a week
    const worn = gapDay ? Math.random() < 0.4 : Math.random() < 0.92;
    if (!worn) continue;

    // Diurnal glucose: dawn rise, post-meal bumps, lower overnight. ~120 mg/dL baseline.
    const diurnal =
      120 +
      25 * Math.sin(((hour - 8) / 24) * 2 * Math.PI) +
      30 * Math.exp(-((hour - 8) ** 2) / 2) + // breakfast
      35 * Math.exp(-((hour - 13) ** 2) / 2) + // lunch
      40 * Math.exp(-((hour - 19) ** 2) / 3); // dinner
    const noise = (Math.random() - 0.5) * 30;
    const value = Math.max(45, Math.min(320, Math.round(diurnal + noise)));

    const trend =
      noise > 8 ? "rising" : noise < -8 ? "falling" : "flat";
    batch.push([accountId, d.toISOString(), value, trend]);
    count++;

    if (batch.length >= 500) {
      await flush(batch);
      batch.length = 0;
    }
  }
  if (batch.length) await flush(batch);

  // Materialize the continuous aggregate over the generated range.
  await query(
    `CALL refresh_continuous_aggregate('cagg_glucose_hourly', $1, $2)`,
    [new Date(start).toISOString(), new Date(now).toISOString()]
  );

  console.log(`[seed:demo-glucose] inserted ${count} synthetic readings for ${code} over ${days} days.`);
  console.log("[seed:demo-glucose] refreshed cagg_glucose_hourly.");
  await pool.end();
}

async function flush(batch: any[]) {
  const values: string[] = [];
  const params: any[] = [];
  batch.forEach((row, i) => {
    const b = i * 4;
    values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, 'synthetic-dev')`);
    params.push(...row);
  });
  await query(
    `INSERT INTO glucose_egv (participant_account_id, ts, glucose_mg_dl, trend, source)
     VALUES ${values.join(",")}
     ON CONFLICT (participant_account_id, ts) DO NOTHING`,
    params
  );
}

main().catch((err) => {
  console.error("[seed:demo-glucose] failed:", err.message);
  process.exit(1);
});
