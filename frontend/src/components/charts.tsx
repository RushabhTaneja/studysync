import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend
);

const GREEN = "#2e7d32";
const AMBER = "#ef9a00";
const RED = "#c62828";
const BLUE = "#1565c0";

/** Stacked horizontal time-in-range bar (below / in-range / above). */
export function TimeInRangeBar({ metrics }: { metrics: any }) {
  const below = (metrics.timeBelow70 ?? 0);
  const above = (metrics.timeAbove180 ?? 0);
  const inRange = Math.max(0, 100 - below - above);
  return (
    <Bar
      data={{
        labels: ["Time in range"],
        datasets: [
          { label: "Below 70", data: [below], backgroundColor: RED },
          { label: "In range 70–180", data: [inRange], backgroundColor: GREEN },
          { label: "Above 180", data: [above], backgroundColor: AMBER },
        ],
      }}
      options={{
        indexAxis: "y" as const,
        responsive: true,
        scales: { x: { stacked: true, max: 100, ticks: { callback: (v) => `${v}%` } }, y: { stacked: true } },
        plugins: { legend: { position: "bottom" } },
      }}
      height={90}
    />
  );
}

/** Ambulatory Glucose Profile: median line with IQR and 10–90 percentile bands. */
export function AgpChart({ profile }: { profile: Array<any> }) {
  const labels = profile.map((p) => `${p.hour}:00`);
  return (
    <Line
      data={{
        labels,
        datasets: [
          { label: "90th", data: profile.map((p) => p.p90), borderColor: "transparent", backgroundColor: "rgba(21,101,192,.12)", fill: "+1", pointRadius: 0 },
          { label: "10th", data: profile.map((p) => p.p10), borderColor: "transparent", backgroundColor: "rgba(21,101,192,.12)", fill: false, pointRadius: 0 },
          { label: "75th", data: profile.map((p) => p.p75), borderColor: "transparent", backgroundColor: "rgba(21,101,192,.28)", fill: "+1", pointRadius: 0 },
          { label: "25th", data: profile.map((p) => p.p25), borderColor: "transparent", backgroundColor: "rgba(21,101,192,.28)", fill: false, pointRadius: 0 },
          { label: "Median", data: profile.map((p) => p.median), borderColor: BLUE, borderWidth: 2, pointRadius: 0, fill: false },
        ],
      }}
      options={{
        responsive: true,
        scales: { y: { title: { display: true, text: "mg/dL" }, suggestedMin: 40, suggestedMax: 300 }, x: { title: { display: true, text: "Time of day" } } },
        plugins: { legend: { display: false } },
      }}
      height={120}
    />
  );
}

/** Histogram of glucose readings (distribution / variability). */
export function HistogramChart({ bins }: { bins: Array<{ label: string; count: number }> }) {
  return (
    <Bar
      data={{
        labels: bins.map((b) => b.label),
        datasets: [{ label: "Readings", data: bins.map((b) => b.count), backgroundColor: BLUE }],
      }}
      options={{
        responsive: true,
        scales: { x: { title: { display: true, text: "Glucose (mg/dL)" } }, y: { title: { display: true, text: "Readings" } } },
        plugins: { legend: { display: false } },
      }}
      height={120}
    />
  );
}

/** Ranked horizontal bar (e.g. cohort comparison). */
export function RankedBar({ items, unit }: { items: Array<{ label: string; value: number }>; unit?: string }) {
  return (
    <Bar
      data={{
        labels: items.map((i) => i.label),
        datasets: [{ label: unit ?? "", data: items.map((i) => i.value), backgroundColor: BLUE }],
      }}
      options={{
        indexAxis: "y" as const,
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { callback: (v) => `${v}${unit ?? ""}` } } },
      }}
      height={Math.max(90, items.length * 28)}
    />
  );
}

/** Calendar-style adherence heatmap: one cell per day, shaded by wear-hours (0–24). */
export function AdherenceHeatmap({ days }: { days: Array<{ day: string; wearHours: number }> }) {
  const color = (h: number) => {
    if (h >= 20) return GREEN;
    if (h >= 12) return "#85c088";
    if (h >= 6) return AMBER;
    if (h > 0) return "#f0b27a";
    return "#e3e7ec";
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {days.map((d) => (
        <div
          key={d.day}
          title={`${d.day}: ${d.wearHours}h worn`}
          style={{ width: 18, height: 18, borderRadius: 3, background: color(d.wearHours) }}
        />
      ))}
    </div>
  );
}
