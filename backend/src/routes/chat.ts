import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config.js";
import { requireAuth } from "../auth/middleware.js";
import { tools, executeTool } from "../services/chatTools.js";

export const chatRouter = Router();
chatRouter.use(requireAuth("researcher"));

const client = config.chatConfigured ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;

const SYSTEM = `You are the StudySync research assistant. You help researchers ask about their cohort
in plain language over two genuine data sources: Dexcom CGM glucose time-series and the EHR clinical
record (Patient, Condition, MedicationRequest, Observation), all keyed by participant code (P01, P02, ...).

Answer ONLY from the data tools — never invent numbers, names, or participants. If a tool returns no
data, say so. Be concise and specific; lead with the answer.

CGM metric conventions (international Time-in-Range consensus, Battelino et al., Diabetes Care 2019):
- Time in range = % of readings 70-180 mg/dL (target >70%).
- Time below range = <70 (and <54 for level 2); time above range = >180 (and >250).
- GMI (Glucose Management Indicator) = 3.31 + 0.02392 x mean glucose (mg/dL), in %.
- %CV = SD/mean x 100; <36% is considered stable.
- "This week" -> days=7, "this month" -> days=30 unless the user says otherwise.

When a visualization helps (time-in-range breakdown, cohort rankings, a typical-day profile, distributions),
call emit_chart with tidy labels/series AND still write a short written answer. Prefer:
- stacked_bar for a single participant's time-in-range (below/in-range/above).
- horizontal_bar for cohort rankings.
- line for ambulatory glucose profile (median curve) or adherence over time.

Note: the CGM sandbox serves a fixed historical window, so metrics are computed over each participant's
most recent available data, not the literal calendar week.`;

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .min(1),
});

chatRouter.post("/", async (req, res) => {
  if (!client) {
    return res.status(503).json({ error: "Insights chat is not configured (missing ANTHROPIC_API_KEY)." });
  }
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const charts: any[] = [];
  const messages: Anthropic.MessageParam[] = parsed.data.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  try {
    // Manual agentic loop: let Claude call read-only data tools until it has a grounded answer.
    let guard = 0;
    while (guard++ < 8) {
      const response = await client.messages.create({
        model: config.anthropicModel,
        max_tokens: 4000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        system: SYSTEM,
        tools,
        messages,
      } as any);

      if (response.stop_reason === "refusal") {
        return res.json({ answer: "I can't help with that request.", charts: [] });
      }

      messages.push({ role: "assistant", content: response.content });

      const toolUses = response.content.filter((b: any) => b.type === "tool_use");
      if (toolUses.length === 0) {
        const answer = response.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n")
          .trim();
        return res.json({ answer, charts });
      }

      const toolResults = [];
      for (const tu of toolUses as any[]) {
        let result: any;
        try {
          result = await executeTool(tu.name, tu.input, charts);
        } catch (err: any) {
          result = { error: err.message };
        }
        toolResults.push({
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: "user", content: toolResults });
    }
    res.json({ answer: "I wasn't able to finish answering that — please try rephrasing.", charts });
  } catch (err: any) {
    console.error("[chat]", err.message);
    res.status(500).json({ error: `Chat failed: ${err.message}` });
  }
});
