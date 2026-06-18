import bcrypt from "bcryptjs";
import { pool, query } from "./pool.js";

/**
 * Seeds the two RBAC roles required by the challenge:
 *   - one researcher (signs in to the dashboard)
 *   - one participant (signs in to the web app, accepts consent, connects sources)
 *
 * The participant connects Dexcom/EHR via the genuine OAuth flow at runtime. Run
 * `npm run seed:demo-glucose` to populate synthetic CGM data for local development of
 * the analytics views (clearly NOT a Dexcom connection — see README).
 */
async function seed() {
  const researcher = {
    email: "researcher@studysync.dev",
    password: "researcher123",
    displayName: "Dr. Alex Snyder",
  };
  const participant = {
    email: "participant@studysync.dev",
    password: "participant123",
    displayName: "Pat Participant",
  };

  const rHash = await bcrypt.hash(researcher.password, 10);
  await query(
    `INSERT INTO accounts (email, password_hash, role, display_name)
     VALUES ($1,$2,'researcher',$3)
     ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, display_name=EXCLUDED.display_name`,
    [researcher.email, rHash, researcher.displayName]
  );

  const pHash = await bcrypt.hash(participant.password, 10);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO accounts (email, password_hash, role, display_name)
     VALUES ($1,$2,'participant',$3)
     ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, display_name=EXCLUDED.display_name
     RETURNING id`,
    [participant.email, pHash, participant.displayName]
  );
  await query(
    `INSERT INTO participants (account_id, participant_code, consent_accepted_at)
     VALUES ($1, 'P01', now())
     ON CONFLICT (account_id) DO UPDATE SET consent_accepted_at = now()`,
    [rows[0].id]
  );

  console.log("\n  Seed complete. Logins:");
  console.log(`    Researcher : ${researcher.email} / ${researcher.password}`);
  console.log(`    Participant: ${participant.email} / ${participant.password}  (code P01)`);
  console.log("\n  The participant connects Dexcom/EHR live via the web app's OAuth flow.\n");
  await pool.end();
}

seed().catch((err) => {
  console.error("[seed] failed:", err.message);
  process.exit(1);
});
