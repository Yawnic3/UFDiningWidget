import { DINING_API_BASE } from "../config/dining.config.js";
import {
  ApiError,
  type Menu,
  type Period,
  type Periods,
} from "../types/dining.types.js";

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function serviceMetadata(value: Record<string, unknown>) {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  const hasWindow =
    typeof value.start === "string" &&
    typeof value.end === "string" &&
    time.test(value.start) &&
    time.test(value.end) &&
    value.start < value.end;

  // Only explicit, validated metadata can override a configured service window.
  // Unknown production fields are ignored until their contract is verified.
  return {
    ...(hasWindow
      ? { start: value.start as string, end: value.end as string }
      : {}),
    ...(typeof value.isClosed === "boolean"
      ? { isClosed: value.isClosed }
      : {}),
  };
}

function period(value: unknown): Period {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    !value.id.trim() ||
    typeof value.name !== "string" ||
    !value.name.trim()
  )
    throw new ApiError(
      502,
      "UPSTREAM_INVALID",
      "Invalid upstream meal period.",
    );
  return { id: value.id, name: value.name.trim(), ...serviceMetadata(value) };
}

export function parseMenu(value: unknown): Menu {
  if (
    !record(value) ||
    !record(value.period) ||
    !Array.isArray(value.period.categories) ||
    !value.period.categories.length
  )
    throw new ApiError(503, "MENU_UNAVAILABLE", "Menu has not been published.");
  const stations = value.period.categories.map((category) => {
    if (
      !record(category) ||
      typeof category.name !== "string" ||
      !category.name.trim() ||
      !Array.isArray(category.items)
    )
      throw new ApiError(502, "UPSTREAM_INVALID", "Invalid upstream station.");
    return {
      name: category.name.trim(),
      ...serviceMetadata(category),
      items: category.items.map((item) => {
        if (!record(item) || typeof item.name !== "string" || !item.name.trim())
          throw new ApiError(
            502,
            "UPSTREAM_INVALID",
            "Invalid food item name.",
          );
        return item.name.trim();
      }),
    };
  });

  if (
    !stations.some(
      (station) => station.items.length > 0 || station.isClosed !== undefined,
    )
  ) {
    throw new ApiError(503, "MENU_UNAVAILABLE", "Menu has not been published.");
  }

  if (value.date !== undefined && typeof value.date !== "string")
    throw new ApiError(502, "UPSTREAM_INVALID", "Invalid menu date.");
  return {
    period: period(value.period),
    date: value.date as string | undefined,
    stations,
  };
}

export class DiningService {
  private cache = new Map<string, { expires: number; value: unknown }>();
  private pending = new Map<string, Promise<unknown>>();

  constructor(
    private fetcher: typeof fetch = fetch,
    private ttl = 300_000,
    private clock = Date.now,
  ) {}

  private async get(path: string): Promise<unknown> {
    const hit = this.cache.get(path);
    if (hit && hit.expires > this.clock()) return hit.value;

    const running = this.pending.get(path);
    if (running) return running;

    const request = (async () => {
      try {
        const response = await this.fetcher(`${DINING_API_BASE}${path}`, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok)
          throw new ApiError(
            502,
            "UPSTREAM_FAILURE",
            `Dining provider returned HTTP ${response.status}.`,
          );

        const value: unknown = await response.json();
        if (!record(value))
          throw new ApiError(
            502,
            "UPSTREAM_INVALID",
            "Invalid dining response.",
          );

        // Bound cache size and remove expired entries; never reuse another date or period.
        for (const [key, entry] of this.cache)
          if (entry.expires <= this.clock()) this.cache.delete(key);
        if (this.cache.size >= 256)
          this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(path, { expires: this.clock() + this.ttl, value });

        return value;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          502,
          "UPSTREAM_FAILURE",
          "Dining provider is unreachable or returned invalid JSON.",
        );
      } finally {
        this.pending.delete(path);
      }
    })();

    this.pending.set(path, request);
    return request;
  }

  async getPeriods(location: string, date: string): Promise<Periods> {
    const value = await this.get(
      `/locations/${location}/periods/?date=${date}`,
    );
    if (!record(value) || !Array.isArray(value.periods))
      throw new ApiError(502, "UPSTREAM_INVALID", "Invalid periods response.");

    let menu: Menu | undefined;
    if (value.menu) {
      try {
        menu = parseMenu(value.menu);
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "MENU_UNAVAILABLE")
          throw error;
      }
    }

    return { periods: value.periods.map(period), menu };
  }

  async getMenu(location: string, date: string, id: string): Promise<Menu> {
    return parseMenu(
      await this.get(
        `/locations/${location}/menu?date=${date}&period=${encodeURIComponent(id)}`,
      ),
    );
  }
}

export const diningService = new DiningService();
