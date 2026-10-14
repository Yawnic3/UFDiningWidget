import type {
  MealSchedule,
  StationSchedule,
} from "../services/meal-selection.service.js";
import type { Schedules } from "./meal-times.config.js";
import { DINING_HALLS } from "./dining.config.js";

function weekly(
  weekday: MealSchedule[],
  weekend: MealSchedule[] = weekday,
): StationSchedule["week"] {
  return Object.fromEntries(
    Array.from({ length: 7 }, (_, day) => [
      day,
      day === 0 || day === 6 ? weekend : weekday,
    ]),
  );
}

const tasteWeekday: MealSchedule[] = [
  { meal: "breakfast", start: "07:00", end: "10:00" },
  { meal: "lunch", start: "11:00", end: "15:00" },
  { meal: "dinner", start: "17:00", end: "21:00" },
];

const tasteWeekend: MealSchedule[] = [
  { meal: "breakfast", start: "08:30", end: "10:45" },
  ...tasteWeekday.slice(1),
];

const continuous: MealSchedule[] = [
  { meal: "lunch", start: "11:00", end: "17:00" },
  { meal: "dinner", start: "17:00", end: "21:00" },
];

const cornerWeekday: MealSchedule[] = [
  { meal: "breakfast", start: "07:00", end: "11:00" },
  ...continuous,
];

const cornerWeekend: MealSchedule[] = [
  { meal: "breakfast", start: "08:30", end: "11:00" },
  ...continuous,
];

// Broward windows are user-provided. Corner station windows remain provisional.
export const DEFAULT_SCHEDULES: Schedules = {
  broward: {
    week: {},
    stations: {
      "Taste of Home": { week: weekly(tasteWeekday, tasteWeekend) },
      "Delicious Without": { week: weekly(continuous) },
      "Gator Grill": { week: weekly(continuous) },
    },
  },
  "gator-corner": {
    week: {},
    stations: Object.fromEntries(
      DINING_HALLS["gator-corner"].stations.map((name) => [
        name,
        { week: weekly(cornerWeekday, cornerWeekend), provisional: true },
      ]),
    ),
  },
};
