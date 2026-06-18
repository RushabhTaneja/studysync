import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";

function relative(ts: string | null): string {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts).getTime();
  const h = Math.round(diff / 3600000);
  if (h < 1) return "just now";
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function ResearcherDashboard() {
  const nav = useNavigate();
  const [cohort, setCohort] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.cohort(), api.alerts()])
      .then(([c, a]) => {
        setCohort(c.cohort);
        setAlerts(a.alerts);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <h1>Cohort overview</h1>
      {error && <div className="error">{error}</div>}

      {alerts.length > 0 && (
        <div className="card" style={{ borderColor: "var(--amber)" }}>
          <h2>⚠ Non-adherence alerts</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Participants below 70% device-wear over the last 7 days.
          </p>
          <table>
            <thead>
              <tr><th>Participant</th><th>Worn (7d)</th><th>Adherence</th></tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.participantCode} className="clickable" onClick={() => nav(`/dashboard/${a.participantCode}`)}>
                  <td><strong>{a.participantCode}</strong> · {a.name}</td>
                  <td>{a.wornHours7d}h / {a.expectedHours7d}h</td>
                  <td><span className="badge warn">{a.adherencePct}%</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>Participants</h2>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Participant</th>
                <th>Consent</th>
                <th>Dexcom</th>
                <th>EHR</th>
                <th>Glucose readings</th>
                <th>Data flow</th>
                <th>Last glucose</th>
              </tr>
            </thead>
            <tbody>
              {cohort.map((p) => (
                <tr key={p.participantCode} className="clickable" onClick={() => nav(`/dashboard/${p.participantCode}`)}>
                  <td><strong>{p.participantCode}</strong> · {p.name}</td>
                  <td>{p.consented ? <span className="badge on">yes</span> : <span className="badge off">no</span>}</td>
                  <td>{p.sources.dexcom.connected ? <span className="badge on">on</span> : <span className="badge off">off</span>}</td>
                  <td>{p.sources.ehr.connected ? <span className="badge on">on</span> : <span className="badge off">off</span>}</td>
                  <td>{p.glucoseReadings.toLocaleString()}</td>
                  <td>{p.dataFlowing ? <span className="badge flow">flowing</span> : <span className="badge off">idle</span>}</td>
                  <td className="muted">{relative(p.lastGlucoseTs)}</td>
                </tr>
              ))}
              {cohort.length === 0 && (
                <tr><td colSpan={7} className="muted">No participants yet.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
