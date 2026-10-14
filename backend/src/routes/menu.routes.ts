import { Router } from "express";
import { DINING_HALLS } from "../config/dining.config.js";
import { menuController } from "../controllers/menu.controller.js";
import type { MenuService } from "../services/menu.service.js";

export function menuRoutes(service: MenuService) {
  const router = Router();
  router.get("/current", menuController(service));
  router.get("/", menuController(service));
  router.get("/stations", (_req, res) =>
    res.json({
      halls: Object.entries(DINING_HALLS).map(([id, h]) => ({
        id,
        name: h.name,
        stations: h.stations,
      })),
    }),
  );
  return router;
}
