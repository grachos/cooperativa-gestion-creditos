import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { associatesRouter } from "./modules/associates/associates.routes.js";
import { societiesRouter } from "./modules/societies/societies.routes.js";
import { applicationsRouter } from "./modules/applications/applications.routes.js";
import { creditsRouter } from "./modules/credits/credits.routes.js";
import { paymentsRouter } from "./modules/payments/payments.routes.js";
import { alertsRouter } from "./modules/alerts/alerts.routes.js";
import { reportsRouter } from "./modules/reports/reports.routes.js";
import { parametersRouter } from "./modules/parameters/parameters.routes.js";
import { auditRouter } from "./modules/audit/audit.routes.js";
import { integrationRouter } from "./modules/integration/integration.routes.js";

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/associates", associatesRouter);
app.use("/api/v1/societies", societiesRouter);
app.use("/api/v1/applications", applicationsRouter);
app.use("/api/v1/credits", creditsRouter);
app.use("/api/v1/payments", paymentsRouter);
app.use("/api/v1/alerts", alertsRouter);
app.use("/api/v1/reports", reportsRouter);
app.use("/api/v1/parameters", parametersRouter);
app.use("/api/v1/audit", auditRouter);
app.use("/api/v1/integration", integrationRouter);

app.use(notFoundHandler);
app.use(errorHandler);
