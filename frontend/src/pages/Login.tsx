import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export function Login() {
  const { login, register, user } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("participant");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    nav(user.role === "researcher" ? "/dashboard" : "/participant", { replace: true });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const u =
        mode === "login"
          ? await login(email, password)
          : await register({ email, password, displayName, role });
      nav(u.role === "researcher" ? "/dashboard" : "/participant", { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="center" style={{ marginBottom: 18 }}>
        <h1 style={{ color: "var(--brand)", marginBottom: 2 }}>StudySync</h1>
        <div className="muted">Wearable Data Platform</div>
      </div>
      <div className="card">
        <div className="pill-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            Sign in
          </button>
          <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
            Register
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        <form onSubmit={submit}>
          {mode === "register" && (
            <>
              <label>
                Name
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
              </label>
              <label>
                Role
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="participant">Participant</option>
                  <option value="researcher">Researcher</option>
                </select>
              </label>
            </>
          )}
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </label>
          <button type="submit" disabled={busy} style={{ width: "100%" }}>
            {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
      </div>
      <div className="card muted" style={{ fontSize: 13 }}>
        <strong>Seeded logins</strong>
        <div>researcher@studysync.dev / researcher123</div>
        <div>participant@studysync.dev / participant123</div>
      </div>
    </div>
  );
}
