import { query } from "../db/pool.js";

export interface GlucoseMetrics {
  readings: number;
  meanGlucose: number | null;
  // Time-in-range family (% of readings), per Battelino et al., Diabetes Care 2019.
  timeInRange: number | null; // 70–180
  timeBelow70: number | null;
  timeBelow54: number | null;
  timeAbove180: number | null;
  timeAbove250: number | null;
  gmi: number | null; // Glucose Management Indicator (%)
  cv: number | null; // coefficient of variation (%)
  rangeStart: string;
  rangeEnd: string;
}

/** Standard CGM glycemic metrics for a participant over [start, end). */
export async function glucoseMetrics(
  participantAccountId: string,
  start: Date,
  end: Date
): Promise<GlucoseMetrics> {
  const { rows } = await query<any>(
    `SELECT
        count(*)::int AS readings,
        avg(glucose_mg_dl) AS mean,
        stddev_samp(glucose_mg_dl) AS sd,
        avg((glucose_mg_dl BETWEEN 70 AND 180)::int) AS tir,
        avg((glucose_mg_dl < 70)::int)  AS tbr70,
        avg((glucose_mg_dl < 54)::int)  AS tbr54,
        avg((glucose_mg_dl > 180)::int) AS tar180,
        avg((glucose_mg_dl > 250)::int) AS tar250
      FROM glucose_egv
      WHERE participant_account_id = $1 AND ts >= $2 AND ts < $3`,
    [participantAccountId, start.toISOString(), end.toISOString()]
  );
  const r = rows[0];
  const pct = (v: any) => (v == null ? null : Math.round(Number(v) * 1000) / 10);
  const mean = r.mean == null ? null : Number(r.mean);
  const sd = r.sd == null ? null : Number(r.sd);
  return {
    readings: r.readings,
    meanGlucose: mean == null ? null : Math.round(mean * 10) / 10,
    timeInRange: pct(r.tir),
    timeBelow70: pct(r.tbr70),
    timeBelow54: pct(r.tbr54),
    timeAbove180: pct(r.tar180),
    timeAbove250: pct(r.tar250),
    gmi: mean == null ? null : Math.round((3.31 + 0.02392 * mean) * 100) / 100,
    cv: mean && sd ? Math.round((sd / mean) * 1000) / 10 : null,
    rangeStart: start.toISOString(),
    rangeEnd: end.toISOString(),
  };
}

/** Ambulatory Glucose Profile: percentile curve by hour-of-day (typical day). */
export async function ambulatoryProfile(
  participantAccountId: string,
  start: Date,
  end: Date
): Promise<Array<{ hour: number; p10: number; p25: number; median: number; p75: number; p90: number }>> {
  const { rows } = await query<any>(
    `SELECT
        extract(hour from ts)::int AS hour,
        percentile_cont(0.10) WITHIN GROUP (ORDER BY glucose_mg_dl) AS p10,
        percentile_cont(0.25) WITHIN GROUP (ORDER BY glucose_mg_dl) AS p25,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY glucose_mg_dl) AS median,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY glucose_mg_dl) AS p75,
        percentile_cont(0.90) WITHIN GROUP (ORDER BY glucose_mg_dl) AS p90
      FROM glucose_egv
      WHERE participant_account_id = $1 AND ts >= $2 AND ts < $3
      GROUP BY 1 ORDER BY 1`,
    [participantAccountId, start.toISOString(), end.toISOString()]
  );
  return rows.map((r) => ({
    hour: r.hour,
    p10: Math.round(r.p10),
    p25: Math.round(r.p25),
    median: Math.round(r.median),
    p75: Math.round(r.p75),
    p90: Math.round(r.p90),
  }));
}

// A Dexcom sensor yields ~12 readings/hour when worn. We count an hour as "worn"
// if it has at least this many readings (>= ~50% of expected).
export const WORN_HOUR_MIN_READINGS = 6;
export const EXPECTED_READINGS_PER_HOUR = 12;

/** Daily wear-hours and reading volume from the hourly continuous aggregate. */
export async function dailyAdherence(
  participantAccountId: string,
  start: Date,
  end: Date
): Promise<Array<{ day: string; wearHours: number; readings: number }>> {
  const { rows } = await query<any>(
    `SELECT
        time_bucket('1 day', bucket)::date AS day,
        count(*) FILTER (WHERE reading_count >= $4) AS wear_hours,
        sum(reading_count)::int AS readings
      FROM cagg_glucose_hourly
      WHERE participant_account_id = $1 AND bucket >= $2 AND bucket < $3
      GROUP BY 1 ORDER BY 1`,
    [participantAccountId, start.toISOString(), end.toISOString(), WORN_HOUR_MIN_READINGS]
  );
  return rows.map((r) => ({
    day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day),
    wearHours: Number(r.wear_hours),
    readings: Number(r.readings),
  }));
}
