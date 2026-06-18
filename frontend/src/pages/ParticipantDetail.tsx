import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, tokenStore } from "../api";
import { TimeInRangeBar, AgpChart, AdherenceHeatmap } from "../components/charts";

function Metric({ label, value, suffix, hint }: { label: string; value: any; suffix?: string; hint?: string }) {
  return (
    <div className="stat" title={hint}>
      {value ?? "—"}{value != null && suffix ? <span style={{ fontSize: 15 }}>{suffix}</span> : ""}
      <small>{label}</small>
    </div>
  );
}

export function ParticipantDetail() {
  const { code } = useParams<{ code: string }>();
  const [detail, setDetail] = useState<any>(null);
  const [adherence, setAdherence] = useState<any>(null);
  const [agp, setAgp] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    if (!code) return;
    setDetail(null);
    Promise.all([api.participant(code, days), api.adherence(code, days), api.agp(code, days)])
      .then(([d, a, g]) => {
        setDetail(d);
        setAdherence(a);
        setAgp(g);
      })
      .catch((e) => setError(e.message));
  }, [code, days]);

  async function downloadExport() {
    if (!code) return;
    const res = await fetch(api.exportUrl(code), {
      headers: { Authorization: `Bearer ${tokenStore.get()}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${code}-export.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (error) return <div className="error">{error}</div>;
  if (!detail) return <p className="muted">Loading {code}…</p>;

  const m = detail.glucose;
  const totalWear = adherence?.days?.reduce((s: number, d: any) => s + d.wearHours, 0) ?? 0;
  const possibleWear = (adherence?.days?.length ?? 0) * 24;
  const adherencePct = possibleWear ? Math.round((totalWear / possibleWear) * 1000) / 10 : 0;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>
          <Link to="/dashboard" className="muted" style={{ textDecoration: "none" }}>← </Link>
          {detail.participantCode} · {detail.name}
        </h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 130 }}>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button onClick={downloadExport}>Export JSON</button>
        </div>
      </div>

      <div className="card">
        <h2>Glucose metrics <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>({m.readings.toLocaleString()} readings)</span></h2>
        {m.readings === 0 ? (
          <p className="muted">No CGM data in this window. Connect Dexcom (or run the dev glucose seeder) to populate.</p>
        ) : (
          <>
            <div className="grid-metrics" style={{ marginBottom: 18 }}>
              <Metric label="Mean glucose" value={m.meanGlucose} suffix=" mg/dL" />
              <Metric label="Time in range" value={m.timeInRange} suffix="%" hint="70–180 mg/dL" />
              <Metric label="Below 70" value={m.timeBelow70} suffix="%" />
              <Metric label="Above 180" value={m.timeAbove180} suffix="%" />
              <Metric label="GMI" value={m.gmi} suffix="%" hint="Glucose Management Indicator" />
              <Metric label="%CV" value={m.cv} suffix="%" hint="Coefficient of variation; <36% = stable" />
            </div>
            <div style={{ maxWidth: 640 }}><TimeInRangeBar metrics={m} /></div>
          </>
        )}
      </div>

      {agp?.profile?.length > 0 && (
        <div className="card">
          <h2>Ambulatory glucose profile <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>(typical day)</span></h2>
          <AgpChart profile={agp.profile} />
        </div>
      )}

      <div className="card">
        <h2>Device-wear adherence</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {adherencePct}% over {adherence?.days?.length ?? 0} days · {totalWear}h worn / {possibleWear}h possible.
          A day's shade reflects worn-hours (an hour counts as worn at ≥6 readings).
        </p>
        {adherence?.days?.length ? <AdherenceHeatmap days={adherence.days} /> : <p className="muted">No data.</p>}
      </div>

      <div className="row">
        <div className="card">
          <h3>Conditions</h3>
          {detail.ehr.conditions.length ? (
            <table>
              <tbody>
                {detail.ehr.conditions.map((c: any, i: number) => (
                  <tr key={i}><td>{c.display}</td><td className="muted">{c.clinical_status ?? ""}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">No EHR conditions (connect EHR).</p>}
        </div>
        <div className="card">
          <h3>Medications</h3>
          {detail.ehr.medications.length ? (
            <table>
              <tbody>
                {detail.ehr.medications.map((med: any, i: number) => (
                  <tr key={i}><td>{med.display}</td><td className="muted">{med.status ?? ""}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">No medications.</p>}
        </div>
      </div>

      <div className="card">
        <h3>Recent observations (labs & vitals)</h3>
        {detail.ehr.observations.length ? (
          <table>
            <thead><tr><th>Observation</th><th>Value</th><th>When</th></tr></thead>
            <tbody>
              {detail.ehr.observations.slice(0, 15).map((o: any, i: number) => (
                <tr key={i}>
                  <td>{o.display ?? o.code}</td>
                  <td>{o.value_quantity != null ? `${o.value_quantity} ${o.value_unit ?? ""}` : "—"}</td>
                  <td className="muted">{o.effective_time ? new Date(o.effective_time).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted">No observations.</p>}
      </div>
    </>
  );
}
