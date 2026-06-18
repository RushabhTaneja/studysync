import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { config } from "./config.js";
import { authOptional } from "./auth/middleware.js";
import { authRouter } from "./auth/routes.js";
import { connectRouter } from "./routes/connect.js";
import { participantRouter } from "./routes/participant.js";
import { researcherRouter } from "./routes/researcher.js";
import { chatRouter } from "./routes/chat.js";

const app = express();

app.use(
  cors({
    origin: [config.frontendBaseUrl],
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(authOptional);

app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    dexcomConfigured: config.dexcom.configured,
    chatConfigured: config.chatConfigured,
    smartIss: config.smart.iss,
  })
);

app.use("/api/auth", authRouter);
app.use("/api/connect", connectRouter);
app.use("/api/participant", participantRouter);
app.use("/api/researcher", researcherRouter);
app.use("/api/researcher/chat", chatRouter);

// Centralized error handler.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[error]", err);
  res.status(500).json({ error: err?.message ?? "Internal server error" });
});

app.listen(config.port, () => {
  console.log(`[studysync] backend listening on ${config.backendBaseUrl} (port ${config.port})`);
  console.log(`[studysync] SMART ISS: ${config.smart.iss}`);
  console.log(`[studysync] Dexcom configured: ${config.dexcom.configured}`);
});
