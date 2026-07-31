import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import path from "node:path";
import { resolveUser } from "./middleware/auth";
import { authRouter } from "./routes/auth";
import { adminRouter } from "./routes/admin";
import { forecastRouter } from "./routes/forecast";
import { dashboardRouter } from "./routes/dashboard";
import { budgetRequestsRouter } from "./routes/budgetRequests";
import { bulkUploadRouter } from "./routes/bulkUpload";
import { sapRouter } from "./routes/sap";
import { additionalHeadcountRouter } from "./routes/additionalHeadcount";
import { manpowerRouter } from "./routes/manpower";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use(resolveUser);

  app.use(
    "/uploads",
    express.static(path.resolve(process.env.UPLOAD_DIR ?? "./uploads"))
  );

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/forecast", forecastRouter);
  app.use("/api/dashboard", dashboardRouter);
  // Mounted before budgetRequestsRouter so its more specific paths (e.g.
  // /bulk-upload/template) are never shadowed by budgetRequestsRouter's
  // catch-all GET "/:id".
  app.use("/api/budget-requests", bulkUploadRouter);
  app.use("/api/budget-requests", budgetRequestsRouter);
  app.use("/api/sap", sapRouter);
  app.use("/api/additional-headcount", additionalHeadcountRouter);
  app.use("/api/manpower", manpowerRouter);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status((err as any).statusCode ?? 500).json({ error: err.message ?? "Internal server error" });
  });

  return app;
}
