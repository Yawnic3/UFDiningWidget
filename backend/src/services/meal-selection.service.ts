import { ApiError } from "../types/dining.types.js";

export type Meal = "breakfast" | "lunch" | "dinner";
export interface MealSchedule {
  meal: Meal;
  start: string;
  end: string;
}

export interface HallSchedule {
  week: Partial<Record<number, MealSchedule[]>>;
  dates?: Record<string, MealSchedule[]>;
  stations?: Record<string, StationSchedule>;
}

export interface StationSchedule extends HallSchedule {
  provisional?: boolean;
}

export function isDate(value: string): boolean {
  const date = new Date(`${value}T12:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

export function stationWindows(
  schedule: HallSchedule,
  station: string,
  date: string,
) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const configured = Object.entries(schedule.stations ?? {}).find(
    ([name]) => name.trim().toLowerCase() === station.trim().toLowerCase(),
  )?.[1];

  // Explicit hall-wide holiday overrides take precedence over weekly defaults.
  const override = schedule.dates?.[date];
  const windows =
    override ??
    configured?.dates?.[date] ??
    configured?.week[day] ??
    schedule.week[day] ??
    [];

  return {
    windows,
    provisional: configured?.provisional ?? false,
    overridden:
      override !== undefined || configured?.dates?.[date] !== undefined,
  };
}

export const TIMEZONE = "America/New_York";
export function localParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: +get("hour") * 60 + +get("minute"),
  };
}

export function addDays(date: string, count: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}

export function zonedTime(date: string, time: string): Date {
  const target = Date.parse(`${date}T${time}:00Z`);
  let guess = target;

  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(guess));
    guess +=
      target -
      Date.parse(
        `${p.date}T${String(Math.floor(p.minutes / 60)).padStart(2, "0")}:${String(p.minutes % 60).padStart(2, "0")}:00Z`,
      );
  }

  return new Date(guess);
}

export function selectMeal(
  schedule: HallSchedule,
  now = new Date(),
  excluded = new Set<string>(),
) {
  const today = localParts(now);

  for (let offset = 0; offset < 8; offset++) {
    const date = addDays(today.date, offset);
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    const meals = schedule.dates?.[date] ?? schedule.week[day] ?? [];

    for (const p of [...meals].sort((a, b) => a.start.localeCompare(b.start))) {
      const start = zonedTime(date, p.start);
      const end = zonedTime(date, p.end);

      if (end > now && !excluded.has(`${date}:${p.meal}`))
        return {
          meal: p.meal,
          date,
          isCurrentlyServing: start <= now,
          nextTransitionAt: (start > now ? start : end).toISOString(),
        };
    }
  }

  throw new ApiError(
    503,
    "MEAL_UNAVAILABLE",
    "No scheduled meal in the next seven days.",
  );
}
