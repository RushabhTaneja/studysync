import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pool } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = readFileSync(join(__dirname, "schema.sql"), "utf8");
  const statements = sql
    .split(/^--\s*@@break\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(--.*\n?)+$/.test(s));

  console.log(`[migrate] running ${statements.length} statements...`);
  for (const [i, stmt] of statements.entries()) {
    const preview = stmt.replace(/\s+/g, " ").slice(0, 70);
    try {
      await pool.query(stmt);
      console.log(`  ✓ [${i + 1}/${statements.length}] ${preview}`);
    } catch (err: any) {
      console.error(`  ✗ [${i + 1}/${statements.length}] ${preview}\n     ${err.message}`);
      throw err;
    }
  }
  console.log("[migrate] done.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("[migrate] failed:", err.message);
  process.exit(1);
});
