import { readFileSync } from "node:fs";
import type { DiningHall } from "./dining.config.js";
import type {
  HallSchedule,
  MealSchedule,
} from "../services/meal-selection.service.js";
import { isDate } from "../services/meal-selection.service.js";
import { DEFAULT_SCHEDULES } from "./default-schedules.config.js";
import { DINING_HALLS } from "./dining.config.js";
import { ApiError } from "../types/dining.types.js";

export type Schedules = Record<DiningHall, HallSchedule>;
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateMeals(value: unknown): asserts value is MealSchedule[] {
  if (!Array.isArray(value)) throw new Error("Schedule must be an array");
  let end = "";
  const seenMeals = new Set<string>();

  for (const period of value) {
    if (
      !object(period) ||
      !["breakfast", "lunch", "dinner"].includes(String(period.meal)) ||
      typeof period.start !== "string" ||
      typeof period.end !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(period.start) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(period.end) ||
      period.start >= period.end ||
      period.start < end ||
      seenMeals.has(String(period.meal))
    )
      throw new Error("Invalid or overlapping meal schedule");
    end = period.end;
    seenMeals.add(String(period.meal));
  }
}

export function parseSchedules(value: unknown): Schedules {
  if (!object(value)) throw new Error("Invalid schedule");
  for (const hall of ["gator-corner", "broward"]) {
    const schedule = value[hall];
    if (!object(schedule) || !object(schedule.week))
      throw new Error(`Missing ${hall} weekly schedule`);
    for (const [day, meals] of Object.entries(schedule.week)) {
      if (!/^[0-6]$/.test(day)) throw new Error("Invalid weekday");
      validateMeals(meals);
    }
    if (schedule.dates !== undefined) {
      if (!object(schedule.dates)) throw new Error("Invalid date overrides");
      for (const [date, meals] of Object.entries(schedule.dates)) {
        if (!isDate(date)) throw new Error("Invalid date");
        validateMeals(meals);
      }
    }
    if (schedule.stations !== undefined) {
      if (!object(schedule.stations))
        throw new Error("Invalid station schedules");
      const supported: readonly string[] =
        DINING_HALLS[hall as DiningHall].stations;

      for (const [name, station] of Object.entries(schedule.stations)) {
        if (
          !supported.includes(name) ||
          !object(station) ||
          !object(station.week)
        ) {
          throw new Error("Invalid station schedule");
        }
        if (
          station.provisional !== undefined &&
          typeof station.provisional !== "boolean"
        ) {
          throw new Error("Invalid provisional flag");
        }
        for (const [day, windows] of Object.entries(station.week)) {
          if (!/^[0-6]$/.test(day)) throw new Error("Invalid weekday");
          validateMeals(windows);
        }
        if (station.dates !== undefined) {
          if (!object(station.dates))
            throw new Error("Invalid station date overrides");
          for (const [date, windows] of Object.entries(station.dates)) {
            if (!isDate(date)) throw new Error("Invalid date");
            validateMeals(windows);
          }
        }
      }
    }
  }
  return value as unknown as Schedules;
}

export function loadSchedules(): Schedules | undefined {
  return process.env.MEAL_SCHEDULE_FILE
    ? parseSchedules(
        JSON.parse(
          readFileSync(process.env.MEAL_SCHEDULE_FILE, "utf8"),
        ) as unknown,
      )
    : DEFAULT_SCHEDULES;
}

export function requireSchedules(value: Schedules | undefined): Schedules {
  if (!value)
    throw new ApiError(
      503,
      "SCHEDULE_UNVERIFIED",
      "Serving times are not configured. Confirm dining hours and set MEAL_SCHEDULE_FILE.",
    );
  return value;
}
