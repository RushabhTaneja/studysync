import { pool, query } from "./pool.js";

/**
 * Removes the dev-only synthetic CGM rows (source='synthetic-dev') so the system runs on
 * genuine data only. Refuses to run for a participant unless real Dexcom data exists, to
 * avoid leaving them with no glucose at all. Rebuilds the continuous aggregate afterward.
 */
async function main() {
  const force = process.argv.includes("--force");

  const { rows: bySource } = await query<any>(
    `SELECT source, count(*)::int AS n FROM glucose_egv GROUP BY source ORDER BY source`
  );
  console.log("Before:", bySource.map((r) => `${r.source}=${r.n}`).join("  ") || "(empty)");

  const dexcom = bySource.find((r) => r.source === "dexcom")?.n ?? 0;
  const synthetic = bySource.find((r) => r.source === "synthetic-dev")?.n ?? 0;

  if (synthetic === 0) {
    console.log("No synthetic rows to remove. Nothing to do.");
    await pool.end();
    return;
  }
  if (dexcom === 0 && !force) {
    console.error(
      "Refusing to delete synthetic rows: no genuine Dexcom data present. " +
        "Connect Dexcom first, or pass --force to delete anyway."
    );
    process.exit(1);
  }

  const del = await query(`DELETE FROM glucose_egv WHERE source='synthetic-dev'`);
  console.log(`Deleted ${del.rowCount} synthetic rows.`);

  // Rebuild the hourly continuous aggregate across the full range.
  await query(`CALL refresh_continuous_aggregate('cagg_glucose_hourly', NULL, NULL)`);
  console.log("Rebuilt cagg_glucose_hourly.");

  const { rows: after } = await query<any>(
    `SELECT source, count(*)::int AS n FROM glucose_egv GROUP BY source ORDER BY source`
  );
  console.log("After:", after.map((r) => `${r.source}=${r.n}`).join("  ") || "(empty)");
  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
