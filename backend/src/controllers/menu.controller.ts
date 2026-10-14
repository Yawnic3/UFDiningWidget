import type { Request, Response, NextFunction } from "express";
import { DINING_HALLS, type DiningHall } from "../config/dining.config.js";
import { ApiError, normalize } from "../types/dining.types.js";
import type { MenuService } from "../services/menu.service.js";
import {
  isDate,
  localParts,
  type Meal,
} from "../services/meal-selection.service.js";

export function menuController(service: MenuService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const hall = req.query.hall;
      if (typeof hall !== "string" || !Object.hasOwn(DINING_HALLS, hall))
        throw new ApiError(
          400,
          "INVALID_HALL",
          "Choose gator-corner or broward.",
        );
      const key = hall as DiningHall;
      const raw = req.query.stations;

      if (typeof raw !== "string" || !raw.trim() || raw.length > 500)
        throw new ApiError(
          400,
          "INVALID_STATIONS",
          "Select one or more supported stations, separated by commas.",
        );
      const stations = [...new Set(raw.split(",").map(normalize))];
      const supported: readonly string[] = DINING_HALLS[key].stations;

      if (
        stations.some((s) => !supported.some((name) => normalize(name) === s))
      )
        throw new ApiError(
          400,
          "UNKNOWN_STATION",
          "A selected station is not supported at this hall.",
        );

      const date = req.query.date;
      const meal = req.query.meal;
      const today = localParts(new Date()).date;

      if (
        date !== undefined &&
        (typeof date !== "string" || !isDate(date) || date < today)
      ) {
        throw new ApiError(
          400,
          "INVALID_DATE",
          "Choose today or a future date in YYYY-MM-DD format.",
        );
      }

      if (
        meal !== undefined &&
        (typeof meal !== "string" ||
          !["breakfast", "lunch", "dinner"].includes(normalize(meal)))
      ) {
        throw new ApiError(
          400,
          "INVALID_MEAL",
          "Choose breakfast, lunch, or dinner.",
        );
      }

      res.set("Cache-Control", "no-store").json(
        await service.getCurrentMenu(
          key,
          stations.map((s) => supported.find((name) => normalize(name) === s)!),
          new Date(),
          {
            ...(typeof date === "string" ? { date } : {}),
            ...(typeof meal === "string"
              ? { meal: normalize(meal) as Meal }
              : {}),
          },
        ),
      );
    } catch (error) {
      next(error);
    }
  };
}
