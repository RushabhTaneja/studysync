import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "../db/pool.js";
import { signToken } from "./jwt.js";
import { requireAuth } from "./middleware.js";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1),
  role: z.enum(["participant", "researcher"]),
});

/** Build the user payload, hydrating participant profile/consent state from the DB. */
async function userPayload(account: {
  id: string;
  email: string;
  role: "participant" | "researcher";
  displayName: string;
}) {
  const base = { id: account.id, email: account.email, role: account.role, displayName: account.displayName };
  if (account.role !== "participant") return base;
  const { rows } = await query<{ participant_code: string; consent_accepted_at: Date | null }>(
    `SELECT participant_code, consent_accepted_at FROM participants WHERE account_id = $1`,
    [account.id]
  );
  return {
    ...base,
    participantCode: rows[0]?.participant_code,
    consentAcceptedAt: rows[0]?.consent_accepted_at ?? null,
  };
}

/** Allocate the next participant code: P01, P02, ... */
async function nextParticipantCode(): Promise<string> {
  const { rows } = await query<{ max: number }>(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(participant_code, '\\D', '', 'g'), '')::int), 0) AS max
       FROM participants`
  );
  const n = (rows[0]?.max ?? 0) + 1;
  return `P${String(n).padStart(2, "0")}`;
}

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password, displayName, role } = parsed.data;

  const exists = await query(`SELECT 1 FROM accounts WHERE email = $1`, [email]);
  if (exists.rowCount) return res.status(409).json({ error: "Email already registered" });

  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO accounts (email, password_hash, role, display_name)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, hash, role, displayName]
  );
  const accountId = rows[0].id;

  if (role === "participant") {
    const code = await nextParticipantCode();
    await query(
      `INSERT INTO participants (account_id, participant_code) VALUES ($1, $2)`,
      [accountId, code]
    );
  }

  const token = signToken({ sub: accountId, role, email, name: displayName });
  const user = await userPayload({ id: accountId, email, role, displayName });
  res.status(201).json({ token, user });
});

const loginSchema = z.object({ email: z.string().email(), password: z.string() });

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password } = parsed.data;

  const { rows } = await query<{
    id: string;
    password_hash: string;
    role: "participant" | "researcher";
    display_name: string;
  }>(`SELECT id, password_hash, role, display_name FROM accounts WHERE email = $1`, [email]);

  const acct = rows[0];
  if (!acct || !(await bcrypt.compare(password, acct.password_hash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = signToken({ sub: acct.id, role: acct.role, email, name: acct.display_name });
  const user = await userPayload({ id: acct.id, email, role: acct.role, displayName: acct.display_name });
  res.json({ token, user });
});

/** Current user + (for participants) their profile/consent state. */
authRouter.get("/me", requireAuth(), async (req, res) => {
  const u = req.user!;
  const user = await userPayload({ id: u.sub, email: u.email, role: u.role, displayName: u.name });
  res.json(user);
});

/** Participant accepts the consent notice. */
authRouter.post("/consent", requireAuth("participant"), async (req, res) => {
  await query(
    `UPDATE participants SET consent_accepted_at = now() WHERE account_id = $1 AND consent_accepted_at IS NULL`,
    [req.user!.sub]
  );
  res.json({ ok: true });
});
