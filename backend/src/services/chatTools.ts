import type Anthropic from "@anthropic-ai/sdk";
import { query } from "../db/pool.js";
import { glucoseMetrics, ambulatoryProfile, dailyAdherence } from "./cgmMetrics.js";

/**
 * Read-only data tools the insights assistant can call. Every tool runs parameterized SQL
 * against the participant's genuine CGM + flattened-FHIR data. `emit_chart` is the one
 * non-data tool: it lets the model attach a visualization the frontend renders.
 */

async function resolveAccountId(code: string): Promise<string | null> {
  const { rows } = await query<{ account_id: string }>(
    `SELECT account_id FROM participants WHERE participant_code = $1`,
    [code]
  );
  return rows[0]?.account_id ?? null;
}

/** Window anchored to the participant's latest reading (CGM sandboxes are historical). */
async function windowFor(accountId: string, days: number): Promise<{ start: Date; end: Date }> {
  const { rows } = await query<{ m: Date | null }>(
    `SELECT max(ts) AS m FROM glucose_egv WHERE participant_account_id = $1`,
    [accountId]
  );
  const latest = rows[0]?.m ? new Date(rows[0].m) : new Date();
  const end = new Date(latest.getTime() + 1000);
  return { start: new Date(end.getTime() - days * 86400000), end };
}

export const tools: Anthropic.Tool[] = [
  {
    name: "cohort_overview",
    description:
      "List all participants in the cohort with which data sources are connected (Dexcom CGM and/or EHR), glucose reading counts, and when their last glucose reading landed. Use for questions about who is enrolled / connected / has data.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "glucose_metrics",
    description:
      "Standard CGM glycemic metrics for one participant over the most recent N days of their data: time-in-range (70-180), time-below-70/54, time-above-180/250, mean glucose, GMI, and %CV. Use for time-in-range / GMI / variability questions about a specific participant.",
    input_schema: {
      type: "object",
      properties: {
        participantCode: { type: "string", description: "e.g. P01" },
        days: { type: "integer", description: "lookback window in days (default 7 for 'this week', 30 for 'this month')" },
      },
      required: ["participantCode"],
      additionalProperties: false,
    },
  },
  {
    name: "glucose_ranking",
    description:
      "Rank the whole cohort by a glucose metric over the most recent N days. metric is one of: time_below_70, time_above_180, time_in_range, mean_glucose, cv. Use for 'which participants spend the most time below 70', 'who is most variable', etc.",
    input_schema: {
      type: "object",
      properties: {
        metric: { type: "string", enum: ["time_below_70", "time_above_180", "time_in_range", "mean_glucose", "cv"] },
        days: { type: "integer", description: "lookback window in days (default 30)" },
      },
      required: ["metric"],
      additionalProperties: false,
    },
  },
  {
    name: "ambulatory_profile",
    description:
      "Ambulatory glucose profile (typical day) for one participant: per-hour-of-day percentile curve (p10/p25/median/p75/p90). Use for 'show P02's typical day by time of day'.",
    input_schema: {
      type: "object",
      properties: { participantCode: { type: "string" }, days: { type: "integer" } },
      required: ["participantCode"],
      additionalProperties: false,
    },
  },
  {
    name: "adherence",
    description:
      "Daily device-wear hours for one participant over the most recent N days (an hour counts as worn at >=6 readings; ~12/hr is full wear). Use for adherence / wear-time questions.",
    input_schema: {
      type: "object",
      properties: { participantCode: { type: "string" }, days: { type: "integer" } },
      required: ["participantCode"],
      additionalProperties: false,
    },
  },
  {
    name: "find_condition",
    description:
      "Find participants whose EHR Condition list matches a search term (case-insensitive substring, e.g. 'diabetes', 'hypertension'). Returns the matching participants and the matched condition text.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "find_medication",
    description:
      "Find participants with an EHR MedicationRequest matching a search term (e.g. 'metformin', 'insulin'). Returns matching participants, the medication name, and order status.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "participant_labs",
    description:
      "EHR Observations (labs & vitals) for one participant, most recent first, optionally filtered by a name/code substring (e.g. 'HbA1c', 'hemoglobin A1c', 'cholesterol'). Use for 'what is P03's most recent HbA1c'.",
    input_schema: {
      type: "object",
      properties: {
        participantCode: { type: "string" },
        nameOrCode: { type: "string", description: "optional substring filter on the observation name/code" },
      },
      required: ["participantCode"],
      additionalProperties: false,
    },
  },
  {
    name: "cohort_demographics",
    description:
      "Breakdown of the cohort by sex and age band (18-44, 45-64, 65+) from EHR Patient demographics. Use for 'break the cohort down by sex and age band'.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "emit_chart",
    description:
      "Attach a visualization to your answer. Call this when a chart helps (time-in-range bars, rankings, distributions, AGP curves). The frontend renders it. Always also write a short text answer.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["bar", "stacked_bar", "line", "horizontal_bar"] },
        title: { type: "string" },
        labels: { type: "array", items: { type: "string" }, description: "x-axis (or category) labels" },
        series: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              data: { type: "array", items: { type: "number" } },
            },
            required: ["name", "data"],
          },
        },
        unit: { type: "string", description: "optional value unit suffix, e.g. '%' or 'mg/dL'" },
      },
      required: ["type", "title", "labels", "series"],
      additionalProperties: false,
    },
  },
];

const METRIC_SQL: Record<string, string> = {
  time_below_70: `avg((glucose_mg_dl < 70)::int)`,
  time_above_180: `avg((glucose_mg_dl > 180)::int)`,
  time_in_range: `avg((glucose_mg_dl BETWEEN 70 AND 180)::int)`,
  mean_glucose: `avg(glucose_mg_dl)`,
  cv: `stddev_samp(glucose_mg_dl) / NULLIF(avg(glucose_mg_dl),0)`,
};

export async function executeTool(name: string, input: any, charts: any[]): Promise<any> {
  switch (name) {
    case "cohort_overview": {
      const { rows } = await query<any>(
        `SELECT p.participant_code,
                bool_or(c.provider='dexcom' AND c.status='connected') AS dexcom,
                bool_or(c.provider='ehr'    AND c.status='connected') AS ehr,
                (SELECT count(*) FROM glucose_egv g WHERE g.participant_account_id=p.account_id) AS glucose_readings,
                (SELECT max(ts) FROM glucose_egv g WHERE g.participant_account_id=p.account_id) AS last_glucose
           FROM participants p
           LEFT JOIN oauth_connections c ON c.participant_account_id=p.account_id
          GROUP BY p.participant_code, p.account_id ORDER BY p.participant_code`
      );
      return rows.map((r) => ({
        participant: r.participant_code,
        dexcomConnected: !!r.dexcom,
        ehrConnected: !!r.ehr,
        glucoseReadings: Number(r.glucose_readings),
        lastGlucose: r.last_glucose,
      }));
    }

    case "glucose_metrics": {
      const id = await resolveAccountId(input.participantCode);
      if (!id) return { error: "unknown participant" };
      const { start, end } = await windowFor(id, input.days ?? 7);
      return { participant: input.participantCode, windowDays: input.days ?? 7, ...(await glucoseMetrics(id, start, end)) };
    }

    case "glucose_ranking": {
      const days = input.days ?? 30;
      const expr = METRIC_SQL[input.metric];
      if (!expr) return { error: "unknown metric" };
      // Anchor each participant's window to their own latest reading.
      const { rows } = await query<any>(
        `WITH latest AS (
           SELECT participant_account_id, max(ts) AS m FROM glucose_egv GROUP BY 1
         )
         SELECT p.participant_code AS participant, ${expr} AS value, count(*) AS readings
           FROM glucose_egv g
           JOIN latest l ON l.participant_account_id=g.participant_account_id
           JOIN participants p ON p.account_id=g.participant_account_id
          WHERE g.ts > l.m - ($1 || ' days')::interval
          GROUP BY p.participant_code
          HAVING count(*) > 0
          ORDER BY value ${input.metric === "time_in_range" ? "DESC" : "DESC"}`,
        [days]
      );
      const pctMetrics = ["time_below_70", "time_above_180", "time_in_range", "cv"];
      return rows.map((r) => ({
        participant: r.participant,
        value: pctMetrics.includes(input.metric)
          ? Math.round(Number(r.value) * 1000) / 10
          : Math.round(Number(r.value) * 10) / 10,
        unit: pctMetrics.includes(input.metric) ? "%" : "mg/dL",
        readings: Number(r.readings),
      }));
    }

    case "ambulatory_profile": {
      const id = await resolveAccountId(input.participantCode);
      if (!id) return { error: "unknown participant" };
      const { start, end } = await windowFor(id, input.days ?? 30);
      return { participant: input.participantCode, profile: await ambulatoryProfile(id, start, end) };
    }

    case "adherence": {
      const id = await resolveAccountId(input.participantCode);
      if (!id) return { error: "unknown participant" };
      const { start, end } = await windowFor(id, input.days ?? 30);
      const series = await dailyAdherence(id, start, end);
      const totalWear = series.reduce((s, d) => s + d.wearHours, 0);
      const possible = series.length * 24;
      return {
        participant: input.participantCode,
        days: series,
        adherencePct: possible ? Math.round((totalWear / possible) * 1000) / 10 : 0,
      };
    }

    case "find_condition": {
      const { rows } = await query<any>(
        `SELECT DISTINCT p.participant_code, c.display, c.clinical_status
           FROM fhir_condition c JOIN participants p ON p.account_id=c.participant_account_id
          WHERE c.display ILIKE '%' || $1 || '%' ORDER BY p.participant_code`,
        [input.text]
      );
      return rows.map((r) => ({ participant: r.participant_code, condition: r.display, status: r.clinical_status }));
    }

    case "find_medication": {
      const { rows } = await query<any>(
        `SELECT DISTINCT p.participant_code, m.display, m.status
           FROM fhir_medication_request m JOIN participants p ON p.account_id=m.participant_account_id
          WHERE m.display ILIKE '%' || $1 || '%' ORDER BY p.participant_code`,
        [input.text]
      );
      return rows.map((r) => ({ participant: r.participant_code, medication: r.display, status: r.status }));
    }

    case "participant_labs": {
      const id = await resolveAccountId(input.participantCode);
      if (!id) return { error: "unknown participant" };
      const filter = input.nameOrCode ? `AND (display ILIKE '%'||$2||'%' OR code ILIKE '%'||$2||'%')` : "";
      const params = input.nameOrCode ? [id, input.nameOrCode] : [id];
      const { rows } = await query<any>(
        `SELECT display, code, value_quantity, value_unit, value_string, effective_time
           FROM fhir_observation
          WHERE participant_account_id=$1 ${filter}
          ORDER BY effective_time DESC NULLS LAST LIMIT 25`,
        params
      );
      return rows.map((r) => ({
        observation: r.display ?? r.code,
        value: r.value_quantity != null ? `${r.value_quantity} ${r.value_unit ?? ""}`.trim() : r.value_string,
        date: r.effective_time ? new Date(r.effective_time).toISOString().slice(0, 10) : null,
      }));
    }

    case "cohort_demographics": {
      const { rows } = await query<any>(
        `SELECT gender,
                CASE
                  WHEN birth_date IS NULL THEN 'unknown'
                  WHEN extract(year from age(birth_date)) < 45 THEN '18-44'
                  WHEN extract(year from age(birth_date)) < 65 THEN '45-64'
                  ELSE '65+'
                END AS age_band,
                count(*) AS n
           FROM fhir_patient GROUP BY 1,2 ORDER BY 2,1`
      );
      return rows.map((r) => ({ gender: r.gender, ageBand: r.age_band, count: Number(r.n) }));
    }

    case "emit_chart": {
      charts.push(input);
      return { ok: true, note: "chart attached to the response" };
    }

    default:
      return { error: `unknown tool ${name}` };
  }
}
