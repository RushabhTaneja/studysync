import { useRef, useState } from "react";
import { api } from "../api";
import { InsightsChart } from "./charts";

interface Msg {
  role: "user" | "assistant";
  content: string;
  charts?: any[];
}

const SUGGESTIONS = [
  "What % of time is P01 in range this week?",
  "Which participants have a diabetes diagnosis?",
  "Who is on metformin?",
  "Rank the cohort by time below 70 mg/dL.",
  "Show P01's typical day by time of day.",
];

export function Chat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setError(null);
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      // Send only role/content history (charts are display-only).
      const history = next.map((m) => ({ role: m.role, content: m.content }));
      const { answer, charts } = await api.chat(history);
      setMessages([...next, { role: "assistant", content: answer, charts }]);
    } catch (e: any) {
      setError(e.message);
      setMessages(next);
    } finally {
      setBusy(false);
      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 50);
    }
  }

  return (
    <div className="card">
      <h2>Insights chat <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· ask about your cohort across glucose & EHR</span></h2>

      <div ref={scrollRef} style={{ maxHeight: 460, overflowY: "auto", marginBottom: 12 }}>
        {messages.length === 0 && (
          <div className="muted" style={{ fontSize: 14 }}>
            <p style={{ marginTop: 0 }}>Try one of these:</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="secondary" style={{ fontSize: 13 }} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ margin: "12px 0", textAlign: m.role === "user" ? "right" : "left" }}>
            <div
              style={{
                display: "inline-block",
                maxWidth: "85%",
                textAlign: "left",
                background: m.role === "user" ? "var(--brand)" : "#f1f3f6",
                color: m.role === "user" ? "#fff" : "var(--ink)",
                padding: "10px 13px",
                borderRadius: 10,
                fontSize: 14,
                whiteSpace: "pre-wrap",
                lineHeight: 1.5,
              }}
            >
              {renderMarkdownish(m.content)}
              {m.charts?.map((c, j) => (
                <div key={j} style={{ background: "#fff", borderRadius: 8, padding: 10, marginTop: 10, minWidth: 280 }}>
                  <InsightsChart spec={c} />
                </div>
              ))}
            </div>
          </div>
        ))}
        {busy && <div className="muted" style={{ fontSize: 14, margin: "12px 0" }}>Analyzing the cohort…</div>}
      </div>

      {error && <div className="error">{error}</div>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about glucose metrics or the clinical record…"
          style={{ marginTop: 0 }}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>Ask</button>
      </form>
    </div>
  );
}

// Minimal markdown-ish rendering for **bold** and bullet lines (the model returns light markdown).
function renderMarkdownish(text: string) {
  return text.split("\n").map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
      p.startsWith("**") && p.endsWith("**") ? <strong key={j}>{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>
    );
    return <div key={i}>{parts}</div>;
  });
}
