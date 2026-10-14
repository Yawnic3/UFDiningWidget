import { DINING_HALLS, type DiningHall } from "../config/dining.config.js";
import {
  loadSchedules,
  requireSchedules,
  type Schedules,
} from "../config/meal-times.config.js";
import { diningService, type DiningService } from "./dining.service.js";
import {
  addDays,
  localParts,
  stationWindows,
  zonedTime,
  type Meal,
} from "./meal-selection.service.js";
import {
  ApiError,
  normalize,
  type Menu,
  type Periods,
} from "../types/dining.types.js";

export interface MenuQuery {
  date?: string;
  meal?: Meal;
}

interface ServiceWindow {
  meal: Meal;
  date: string;
  startsAt: string;
  endsAt: string;
  scheduleSource: "configured" | "provisional" | "live";
  availability: "available" | "unavailable";
  items: string[];
  reason?: string;
}

interface StationResult {
  name: string;
  status: "serving" | "closed" | "unknown" | "scheduled";
  current: ServiceWindow | null;
  next: ServiceWindow | null;
  scheduled?: ServiceWindow[];
}

interface DailyData {
  periods?: Periods;
  menus: Map<string, Menu>;
  error?: string;
}

export class MenuService {
  constructor(
    private schedules: Schedules | undefined = loadSchedules(),
    private dining: Pick<
      DiningService,
      "getPeriods" | "getMenu"
    > = diningService,
  ) {}

  private async dailyData(location: string, date: string): Promise<DailyData> {
    const menus = new Map<string, Menu>();
    let periods: Periods;

    try {
      periods = await this.dining.getPeriods(location, date);
    } catch (error) {
      return {
        menus,
        error: error instanceof ApiError ? error.code : "UPSTREAM_FAILURE",
      };
    }

    await Promise.all(
      periods.periods.map(async (period) => {
        if (!["breakfast", "lunch", "dinner"].includes(normalize(period.name)))
          return;

        try {
          const menu =
            periods.menu?.period.id === period.id
              ? periods.menu
              : await this.dining.getMenu(location, date, period.id);

          if (
            menu.period.id !== period.id ||
            normalize(menu.period.name) !== normalize(period.name) ||
            (menu.date !== undefined && menu.date !== date)
          ) {
            throw new ApiError(
              502,
              "UPSTREAM_INVALID",
              "Dining menu does not match requested date and meal.",
            );
          }

          menus.set(period.id, menu);
        } catch (error) {
          // Availability is tracked separately from scheduled hours. Never infer closure.
          if (error instanceof ApiError && error.code === "UPSTREAM_INVALID")
            throw error;
        }
      }),
    );

    return { periods, menus };
  }

  private windows(
    hall: DiningHall,
    station: string,
    date: string,
    data: DailyData,
  ): ServiceWindow[] {
    const schedule = requireSchedules(this.schedules)[hall];
    const configured = stationWindows(schedule, station, date);
    const periods = data.periods?.periods ?? [];
    const windows = [...configured.windows];

    // A live timed period may introduce an unusual meal on a provisional day.
    // Explicit date overrides (including holiday closures) remain intentional.
    if (configured.provisional && !configured.overridden) {
      for (const period of periods) {
        const meal = normalize(period.name) as Meal;
        if (
          ["breakfast", "lunch", "dinner"].includes(meal) &&
          period.start &&
          period.end &&
          !windows.some((window) => window.meal === meal)
        ) {
          windows.push({ meal, start: period.start, end: period.end });
        }
      }
    }

    return windows
      .flatMap((window) => {
      const listedPeriod = periods.find(
          (period) => normalize(period.name) === window.meal,
        );
      const menu = listedPeriod ? data.menus.get(listedPeriod.id) : undefined;
      const period = listedPeriod ? { ...listedPeriod, ...menu?.period } : undefined;
        const liveStation = menu?.stations.find(
          (candidate) => normalize(candidate.name) === normalize(station),
        );

        if (
          configured.provisional &&
          !configured.overridden &&
          periods.length > 0 &&
          !period
        )
          return [];

        if (period?.isClosed === true || liveStation?.isClosed === true)
          return [];

        let start = window.start;
        let end = window.end;
        let scheduleSource: ServiceWindow["scheduleSource"] =
          configured.provisional ? "provisional" : "configured";

        if (!configured.overridden) {
          if (liveStation?.start && liveStation.end) {
            start = liveStation.start;
            end = liveStation.end;
            scheduleSource = "live";
          } else if (period?.start && period.end) {
            // Hall-wide times must not reopen a known closed Broward station.
            start = configured.provisional
              ? period.start
              : period.start > start
                ? period.start
                : start;
            end = configured.provisional
              ? period.end
              : period.end < end
                ? period.end
                : end;
            scheduleSource = "live";
          }
        }

        if (start >= end) return [];

        // A provisional schedule never proves station-specific meal availability.
        const available = Boolean(liveStation?.items.length);
        return [
          {
            meal: window.meal,
            date,
            startsAt: zonedTime(date, start).toISOString(),
            endsAt: zonedTime(date, end).toISOString(),
            scheduleSource,
            availability: available
              ? ("available" as const)
              : ("unavailable" as const),
            items: available ? liveStation!.items : [],
            ...(!available ? { reason: data.error ?? "MENU_UNAVAILABLE" } : {}),
          },
        ];
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  async getCurrentMenu(
    hall: DiningHall,
    selected: string[],
    now = new Date(),
    query: MenuQuery = {},
  ) {
    requireSchedules(this.schedules);

    const location = DINING_HALLS[hall];
    const today = localParts(now).date;
    const date = query.date ?? today;
    const explicit = query.date !== undefined || query.meal !== undefined;
    const results: StationResult[] = selected.map((name) => ({
      name:
        (location.stations as readonly string[]).find(
          (s) => normalize(s) === normalize(name),
        ) ?? name,
      status: explicit ? "scheduled" : "closed",
      current: null,
      next: null,
    }));

    // Explicit queries stay on the requested date. Automatic mode looks ahead
    // through seven days for the next scheduled station service, not old menus.
    for (let offset = 0; offset < (explicit ? 1 : 8); offset++) {
      const serviceDate = addDays(date, offset);
      const needsData = results.some((result) => {
        const schedule = stationWindows(
          this.schedules![hall],
          result.name,
          serviceDate,
        );
        return !result.next && schedule.windows.length > 0;
      });
      const data = needsData
        ? await this.dailyData(location.locationId, serviceDate)
        : { menus: new Map<string, Menu>() };

      for (const result of results) {
        const windows = this.windows(hall, result.name, serviceDate, data);

        if (explicit) {
          const requested = windows.filter(
            (window) => !query.meal || window.meal === query.meal,
          );
          result.scheduled = requested;
          result.next =
            requested.find((window) => new Date(window.startsAt) > now) ?? null;
          result.status = requested.length ? "scheduled" : "closed";
          continue;
        }

        if (offset === 0) {
          result.current =
            windows.find(
              (window) =>
                new Date(window.startsAt) <= now &&
                now < new Date(window.endsAt),
            ) ?? null;
          const stationSchedule = stationWindows(
            this.schedules![hall],
            result.name,
            serviceDate,
          );
          result.status = result.current
            ? result.current.availability === "available"
              ? "serving"
              : "unknown"
            : stationSchedule.provisional &&
                stationSchedule.windows.some(
                  (window) =>
                    zonedTime(serviceDate, window.start) <= now &&
                    now < zonedTime(serviceDate, window.end),
                ) &&
                data.error
              ? "unknown"
              : "closed";
        }

        result.next ??=
          windows.find((window) => new Date(window.startsAt) > now) ?? null;
      }

      if (results.every((result) => result.next)) break;
    }

    const transitions = results
      .flatMap((result) => [result.current?.endsAt, result.next?.startsAt])
      .filter(
        (value): value is string => Boolean(value) && new Date(value!) > now,
      );

    return {
      hall: location.name,
      date,
      timezone: "America/New_York",
      queryMode: explicit ? "scheduled" : "current",
      nextTransitionAt: transitions.sort()[0] ?? null,
      stations: results,
    };
  }
}
