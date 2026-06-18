import { pool, query } from "./pool.js";

// Diagnostic: glucose row counts by source per participant, plus latest timestamp.
async function main() {
  const { rows } = await query<any>(
    `SELECT p.participant_code, g.source,
            count(*)::int AS readings,
            min(g.ts) AS first_ts,
            max(g.ts) AS last_ts
       FROM glucose_egv g
       JOIN participants p ON p.account_id = g.participant_account_id
       GROUP BY p.participant_code, g.source
       ORDER BY p.participant_code, g.source`
  );
  if (!rows.length) console.log("(no glucose rows)");
  for (const r of rows) {
    console.log(
      `${r.participant_code}  source=${r.source}  readings=${r.readings}  ` +
        `range=${new Date(r.first_ts).toISOString().slice(0, 10)}..${new Date(r.last_ts).toISOString().slice(0, 16)}`
    );
  }
  await pool.end();
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
