import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

const CONSENT_TEXT = `By participating in StudySync you consent to share data from the sources you connect
(continuous glucose readings from Dexcom and your clinical record via SMART-on-FHIR) with the
research team for the purpose of this study. Data is synthetic sandbox data. You may disconnect
any source at any time, which stops further data collection.`;

function SourceCard({
  title,
  description,
  provider,
  status,
  onChanged,
}: {
  title: string;
  description: string;
  provider: "dexcom" | "ehr";
  status: any;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = status?.status === "connected";

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const { authorizeUrl } = await api.startConnect(provider);
      window.location.href = authorizeUrl; // hand off to the provider's OAuth screen
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await api.disconnect(provider);
      onChanged();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>{title}</h3>
      <p className="muted" style={{ marginTop: 0 }}>{description}</p>
      <div style={{ marginBottom: 10 }}>
        {connected ? (
          <span className="badge on">Connected</span>
        ) : (
          <span className="badge off">Not connected</span>
        )}
        {status?.last_data_at && (
          <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>
            last data {new Date(status.last_data_at).toLocaleString()}
          </span>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {connected ? (
        <button className="secondary" onClick={disconnect} disabled={busy}>
          Disconnect
        </button>
      ) : (
        <button onClick={connect} disabled={busy}>
          {busy ? "Redirecting…" : `Connect ${title}`}
        </button>
      )}
    </div>
  );
}

export function Participant() {
  const { user, refresh } = useAuth();
  const [status, setStatus] = useState<any>(null);
  const [data, setData] = useState<any>(null);
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState(false);

  const consented = !!user?.consentAcceptedAt;

  async function load() {
    const [s, d] = await Promise.all([api.myStatus(), api.myData()]);
    setStatus(s);
    setData(d);
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function acceptConsent() {
    setBusy(true);
    await api.acceptConsent();
    await refresh();
    setBusy(false);
  }

  const connectedFlag = params.get("connected");
  const errorFlag = params.get("error");

  return (
    <>
      <h1>Welcome, {user?.displayName}</h1>
      {connectedFlag && (
        <div className="success">
          Connected {connectedFlag.toUpperCase()} successfully. Your data is being collected.{" "}
          <a onClick={() => { setParams({}); load(); }} style={{ cursor: "pointer" }}>refresh</a>
        </div>
      )}
      {errorFlag && (
        <div className="error">
          Could not connect {errorFlag.toUpperCase()}. Please try again.
          {params.get("reason") && <div style={{ marginTop: 6, fontSize: 13 }}>Reason: {params.get("reason")}</div>}{" "}
          <a onClick={() => setParams({})} style={{ cursor: "pointer" }}>dismiss</a>
        </div>
      )}

      {!consented ? (
        <div className="card">
          <h2>Consent notice</h2>
          <p className="muted">{CONSENT_TEXT}</p>
          <button onClick={acceptConsent} disabled={busy}>
            I consent and want to participate
          </button>
        </div>
      ) : (
        <>
          <div className="row">
            <SourceCard
              title="Dexcom CGM"
              description="Continuous glucose monitor. Connect your Dexcom sandbox account to share glucose readings."
              provider="dexcom"
              status={status?.dexcom}
              onChanged={load}
            />
            <SourceCard
              title="EHR"
              description="Electronic health record via SMART-on-FHIR. Connect to share your clinical record."
              provider="ehr"
              status={status?.ehr}
              onChanged={load}
            />
          </div>

          <div className="card">
            <h2>My data</h2>
            {!data ? (
              <p className="muted">Loading…</p>
            ) : (
              <div className="grid-metrics">
                <div className="stat">
                  {data.glucose.readings.toLocaleString()}
                  <small>glucose readings</small>
                </div>
                <div className="stat">
                  {data.glucose.latest ? `${data.glucose.latest.glucose_mg_dl}` : "—"}
                  <small>latest mg/dL</small>
                </div>
                <div className="stat">
                  {data.ehr.conditions}
                  <small>conditions</small>
                </div>
                <div className="stat">
                  {data.ehr.medications}
                  <small>medications</small>
                </div>
                <div className="stat">
                  {data.ehr.observations}
                  <small>observations</small>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
