import express, { type ErrorRequestHandler } from "express";
import { loadSchedules } from "./config/meal-times.config.js";
import { MenuService } from "./services/menu.service.js";
import { menuRoutes } from "./routes/menu.routes.js";
import { ApiError } from "./types/dining.types.js";

export function createApp(service = new MenuService(loadSchedules())) {
  const app = express();
  app.disable("x-powered-by");
  app.get("/api/health", (_req, res) =>
    res.json({
      status: "ok",
      service: "gator-eats-api",
      timestamp: new Date().toISOString(),
    }),
  );
  app.use("/api/menu", menuRoutes(service));
  app.use((_req, res) =>
    res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "Endpoint not found." } }),
  );
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const e =
      error instanceof ApiError
        ? error
        : new ApiError(500, "INTERNAL_ERROR", "Unable to retrieve menu.");
    res
      .set("Cache-Control", "no-store")
      .status(e.status)
      .json({
        error: {
          code: e.code,
          message: e.message,
          retryAfterSeconds: e.status >= 500 ? 900 : undefined,
        },
      });
  };
  app.use(errors);
  return app;
}

export default createApp();
