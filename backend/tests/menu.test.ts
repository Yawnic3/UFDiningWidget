import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { DEFAULT_SCHEDULES } from "../src/config/default-schedules.config.js";
import {
  parseSchedules,
  type Schedules,
} from "../src/config/meal-times.config.js";
import { DiningService, parseMenu } from "../src/services/dining.service.js";
import {
  addDays,
  localParts,
  selectMeal,
  stationWindows,
} from "../src/services/meal-selection.service.js";
import { MenuService } from "../src/services/menu.service.js";
import type { Menu, Period, Periods } from "../src/types/dining.types.js";

const names = [
  "Taste of Home",
  "Delicious Without",
  "Gator Grill",
  "Homestyle",
  "500 Degrees",
  "Grill Works",
  "Global Flame",
];
const periods: Period[] = ["Breakfast", "Lunch", "Dinner"].map((name) => ({
  id: `dynamic-${name}`,
  name,
}));

function provider(
  options: {
    periods?: Period[];
    empty?: boolean;
    missing?: string;
    closed?: string;
  } = {},
) {
  const calls: string[] = [];

  return {
    calls,
    async getPeriods(_location: string, _date: string): Promise<Periods> {
      return { periods: options.periods ?? periods };
    },
    async getMenu(_location: string, date: string, id: string): Promise<Menu> {
      calls.push(`${date}:${id}`);
      const period = (options.periods ?? periods).find(
        (period) => period.id === id,
      )!;

      return {
        date,
        period,
        stations: names
          .filter((name) => name !== options.missing)
          .map((name) => ({
            name,
            items: options.empty ? [] : [`${period.name} food`, "Side"],
            ...(name === options.closed ? { isClosed: true } : {}),
          })),
      };
    },
  };
}

function at(date: string, time: string) {
  return new Date(`${date}T${time}:00-04:00`);
}

for (const [date, time, expectedCurrent, expectedNext] of [
  ["2026-10-14", "06:59", null, "breakfast"],
  ["2026-10-14", "07:00", "breakfast", "lunch"],
  ["2026-10-14", "10:00", null, "lunch"],
  ["2026-10-14", "11:00", "lunch", "dinner"],
  ["2026-10-14", "15:00", null, "dinner"],
  ["2026-10-14", "16:59", null, "dinner"],
  ["2026-10-14", "17:00", "dinner", "breakfast"],
  ["2026-10-14", "21:00", null, "breakfast"],
  ["2026-10-17", "08:29", null, "breakfast"],
  ["2026-10-17", "08:30", "breakfast", "lunch"],
  ["2026-10-17", "10:44", "breakfast", "lunch"],
  ["2026-10-17", "10:45", null, "lunch"],
  ["2026-10-18", "10:59", null, "lunch"],
  ["2026-10-18", "11:00", "lunch", "dinner"],
] as const) {
  test(`Taste of Home ${date} ${time}`, async () => {
    const result = await new MenuService(
      DEFAULT_SCHEDULES,
      provider(),
    ).getCurrentMenu("broward", ["Taste of Home"], at(date, time));
    const station = result.stations[0];

    assert.equal(station.current?.meal ?? null, expectedCurrent);
    assert.equal(station.next?.meal, expectedNext);
    assert.equal(station.status, expectedCurrent ? "serving" : "closed");
    if (!expectedCurrent) assert.equal(station.current, null);
  });
}

test("Broward stations have different simultaneous states at 16:00", async () => {
  const result = await new MenuService(
    DEFAULT_SCHEDULES,
    provider(),
  ).getCurrentMenu("broward", names.slice(0, 3), at("2026-10-14", "16:00"));

  assert.equal(result.stations[0].current, null);
  assert.equal(result.stations[0].next?.meal, "dinner");
  for (const station of result.stations.slice(1)) {
    assert.equal(station.current?.meal, "lunch");
    assert.equal(station.status, "serving");
  }
  assert.equal(result.nextTransitionAt, "2026-10-14T21:00:00.000Z");
});

for (const time of ["16:59", "17:00"]) {
  test(`continuous stations switch at ${time}`, async () => {
    const result = await new MenuService(
      DEFAULT_SCHEDULES,
      provider(),
    ).getCurrentMenu(
      "broward",
      ["Delicious Without", "Gator Grill"],
      at("2026-10-18", time),
    );

    for (const station of result.stations) {
      assert.equal(
        station.current?.meal,
        time === "16:59" ? "lunch" : "dinner",
      );
      assert.equal(station.status, "serving");
    }
  });
}

test("continuous Broward stations never serve breakfast", async () => {
  const result = await new MenuService(
    DEFAULT_SCHEDULES,
    provider(),
  ).getCurrentMenu("broward", ["Gator Grill"], at("2026-10-14", "09:00"));

  assert.equal(result.stations[0].current, null);
  assert.equal(result.stations[0].next?.meal, "lunch");
});

test("Gator Corner weekday/weekend fallback is explicitly provisional", async () => {
  for (const [date, serving] of [
    ["2026-10-14", true],
    ["2026-10-17", false],
  ] as const) {
    const result = await new MenuService(
      DEFAULT_SCHEDULES,
      provider(),
    ).getCurrentMenu("gator-corner", ["Homestyle"], at(date, "08:00"));
    assert.equal(Boolean(result.stations[0].current), serving);
    assert.equal(
      (result.stations[0].current ?? result.stations[0].next)?.scheduleSource,
      "provisional",
    );
  }
});

test("live timed periods override provisional hours and missing periods are not invented", async () => {
  const livePeriods = [
    { id: "special", name: "Lunch", start: "10:30", end: "16:00" },
    periods[2],
  ];
  const result = await new MenuService(
    DEFAULT_SCHEDULES,
    provider({ periods: livePeriods }),
  ).getCurrentMenu("gator-corner", ["Homestyle"], at("2026-10-14", "10:45"));

  assert.equal(result.stations[0].current?.meal, "lunch");
  assert.equal(result.stations[0].current?.scheduleSource, "live");
  assert.equal(
    result.stations[0].current?.startsAt,
    "2026-10-14T14:30:00.000Z",
  );
});

test("hall-wide lunch hours do not reopen Taste of Home at 16:00", async () => {
  const livePeriods = [
    periods[0],
    { ...periods[1], start: "11:00", end: "17:00" },
    periods[2],
  ];
  const result = await new MenuService(
    DEFAULT_SCHEDULES,
    provider({ periods: livePeriods }),
  ).getCurrentMenu("broward", ["Taste of Home"], at("2026-10-14", "16:00"));

  assert.equal(result.stations[0].current, null);
  assert.equal(result.stations[0].status, "closed");
});

test("explicit live station windows handle unusual hours", async () => {
  const source = provider();
  const original = source.getMenu;
  source.getMenu = async (...args) => {
    const menu = await original(...args);
    return {
      ...menu,
      stations: menu.stations.map((station) =>
        station.name === "Taste of Home" && menu.period.name === "Lunch"
          ? { ...station, start: "12:00", end: "16:30" }
          : station,
      ),
    };
  };
  const result = await new MenuService(
    DEFAULT_SCHEDULES,
    source,
  ).getCurrentMenu("broward", ["Taste of Home"], at("2026-10-14", "16:00"));

  assert.equal(result.stations[0].current?.scheduleSource, "live");
  assert.equal(result.stations[0].status, "serving");
});

test("missing and empty menus mean unknown availability, not closed", async () => {
  for (const source of [
    provider({ empty: true }),
    provider({ missing: "Homestyle" }),
    {
      getPeriods: async () => {
        throw Error("offline");
      },
      getMenu: provider().getMenu,
    },
  ]) {
    const result = await new MenuService(
      DEFAULT_SCHEDULES,
      source,
    ).getCurrentMenu("gator-corner", ["Homestyle"], at("2026-10-14", "12:00"));
    assert.equal(result.stations[0].status, "unknown");
    assert.equal(result.stations[0].current?.availability, "unavailable");
    assert.deepEqual(result.stations[0].current?.items, []);
  }
});

test("explicit closed station never exposes food items", async () => {
  const result = await new MenuService(
    DEFAULT_SCHEDULES,
    provider({ closed: "Homestyle" }),
  ).getCurrentMenu("gator-corner", ["Homestyle"], at("2026-10-14", "12:00"));

  assert.equal(result.stations[0].status, "closed");
  assert.equal(result.stations[0].current, null);
  assert.equal(result.stations[0].next, null);
});

test("holiday and station-specific date overrides", async () => {
  const schedules: Schedules = structuredClone(DEFAULT_SCHEDULES);
  schedules.broward.dates = { "2026-10-14": [] };
  schedules.broward.stations!["Taste of Home"].dates = {
    "2026-10-15": [{ meal: "dinner", start: "18:00", end: "20:00" }],
  };
  const result = await new MenuService(schedules, provider()).getCurrentMenu(
    "broward",
    ["Taste of Home"],
    at("2026-10-14", "12:00"),
  );

  assert.equal(result.stations[0].current, null);
  assert.equal(result.stations[0].next?.date, "2026-10-15");
  assert.equal(result.stations[0].next?.startsAt, "2026-10-15T22:00:00.000Z");
});

test("explicit date and meal query is scheduled, never relabeled current", async () => {
  const service = new MenuService(DEFAULT_SCHEDULES, provider());
  const future = await service.getCurrentMenu(
    "broward",
    ["Taste of Home", "Gator Grill"],
    at("2026-10-14", "12:00"),
    { date: "2026-10-17", meal: "breakfast" },
  );

  assert.equal(future.queryMode, "scheduled");
  assert.equal(future.stations[0].current, null);
  assert.equal(
    future.stations[0].scheduled?.[0].startsAt,
    "2026-10-17T12:30:00.000Z",
  );
  assert.deepEqual(future.stations[1].scheduled, []);

  const earlierToday = await service.getCurrentMenu(
    "broward",
    ["Taste of Home"],
    at("2026-10-14", "16:00"),
    { meal: "lunch" },
  );
  assert.equal(earlierToday.stations[0].scheduled?.[0].meal, "lunch");
  assert.equal(earlierToday.stations[0].current, null);
  assert.equal(earlierToday.stations[0].next, null);
});

test("date-only query lists all scheduled meals", async () => {
  const result = await new MenuService(
    DEFAULT_SCHEDULES,
    provider(),
  ).getCurrentMenu("broward", ["Taste of Home"], at("2026-10-14", "12:00"), {
    date: "2026-10-17",
  });
  assert.deepEqual(
    result.stations[0].scheduled?.map((window) => window.meal),
    ["breakfast", "lunch", "dinner"],
  );
});

test("New York dates and daylight saving time", () => {
  assert.equal(localParts(new Date("2026-10-15T02:00:00Z")).date, "2026-10-14");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");

  const schedule = {
    week: { 0: [{ meal: "breakfast" as const, start: "08:30", end: "11:00" }] },
  };
  assert.equal(
    selectMeal(schedule, new Date("2026-11-01T04:00:00Z")).nextTransitionAt,
    "2026-11-01T13:30:00.000Z",
  );
  assert.equal(
    selectMeal(schedule, new Date("2026-03-08T05:00:00Z")).nextTransitionAt,
    "2026-03-08T12:30:00.000Z",
  );
});

test("schedule validation accepts defaults and rejects malformed dates/overlaps/stations", () => {
  assert.deepEqual(parseSchedules(DEFAULT_SCHEDULES), DEFAULT_SCHEDULES);
  for (const mutate of [
    (s: Schedules) => {
      s.broward.dates = { "2026-02-30": [] };
    },
    (s: Schedules) => {
      s.broward.stations!["Imaginary"] = { week: {} };
    },
    (s: Schedules) => {
      s.broward.stations!["Taste of Home"].week[1] = [
        { meal: "lunch", start: "12:00", end: "11:00" },
      ];
    },
  ]) {
    const schedules = structuredClone(DEFAULT_SCHEDULES);
    mutate(schedules);
    assert.throws(() => parseSchedules(schedules));
  }
  assert.equal(
    stationWindows(DEFAULT_SCHEDULES.broward, " taste of home ", "2026-10-17")
      .windows[0].end,
    "10:45",
  );
});

const raw = {
  date: "2026-10-14",
  period: {
    id: "b",
    name: "Breakfast",
    start: "07:00",
    end: "10:00",
    categories: [
      {
        name: " Homestyle ",
        items: [{ name: " Eggs ", calories: 123 }, { name: "Toast" }],
      },
    ],
  },
};

test("only food names, preserved order, validated timing metadata", () => {
  const menu = parseMenu(raw);
  assert.deepEqual(menu.stations, [
    { name: "Homestyle", items: ["Eggs", "Toast"] },
  ]);
  assert.equal(menu.period.start, "07:00");
  assert.ok(!JSON.stringify(menu).includes("calories"));
  assert.throws(() =>
    parseMenu({ period: { id: "x", name: "Lunch", categories: [] } }),
  );
});

test("embedded menu is reused and mismatched menu dates are rejected", async () => {
  const menu = parseMenu(raw);
  let requests = 0;
  const source = {
    getPeriods: async () => ({ periods: [menu.period], menu }),
    getMenu: async () => {
      requests++;
      return menu;
    },
  };
  await new MenuService(DEFAULT_SCHEDULES, source).getCurrentMenu(
    "gator-corner",
    ["Homestyle"],
    at("2026-10-14", "08:00"),
    { meal: "breakfast" },
  );
  assert.equal(requests, 0);
  await assert.rejects(
    new MenuService(DEFAULT_SCHEDULES, source).getCurrentMenu(
      "gator-corner",
      ["Homestyle"],
      at("2026-10-14", "08:00"),
      { date: "2026-10-15" },
    ),
    { code: "UPSTREAM_INVALID" },
  );
});

test("cache deduplicates concurrent requests, expires, and separates dates and periods", async () => {
  let calls = 0;
  let time = 0;
  const service = new DiningService(
    async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json({ periods: [raw.period], menu: raw });
    },
    100,
    () => time,
  );

  await Promise.all([
    service.getPeriods("x", "2026-10-14"),
    service.getPeriods("x", "2026-10-14"),
  ]);
  assert.equal(calls, 1);
  await service.getPeriods("x", "2026-10-14");
  assert.equal(calls, 1);
  time = 101;
  await service.getPeriods("x", "2026-10-14");
  await service.getPeriods("x", "2026-10-15");
  assert.equal(calls, 3);
});

test("upstream failures are not cached", async () => {
  let calls = 0;
  const service = new DiningService(async () => {
    calls++;
    return new Response(".", { status: 403 });
  });
  for (let i = 0; i < 2; i++)
    await assert.rejects(service.getPeriods("x", "2026-10-14"), {
      code: "UPSTREAM_FAILURE",
    });
  assert.equal(calls, 2);
});

test("HTTP endpoints, invalid parameters, scheduled queries and safe unavailable states", async () => {
  const server = createApp(
    new MenuService(DEFAULT_SCHEDULES, provider()),
  ).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    for (const path of ["/api/health", "/api/menu/stations"])
      assert.equal((await fetch(base + path)).status, 200);
    for (const query of [
      "hall=bad&stations=Homestyle",
      "hall=broward&stations=Homestyle",
      "hall=broward",
      "hall=broward&stations=Gator%20Grill&date=2026-02-30",
      "hall=broward&stations=Gator%20Grill&date=2000-01-01",
      "hall=broward&stations=Gator%20Grill&meal=brunch",
      "hall=broward&stations=Gator%20Grill&meal=lunch&meal=dinner",
    ]) {
      assert.equal(
        (await fetch(`${base}/api/menu/current?${query}`)).status,
        400,
      );
    }

    const date = addDays(localParts(new Date()).date, 2);
    const response = await fetch(
      `${base}/api/menu?hall=broward&stations=Taste%20of%20Home&date=${date}&meal=lunch`,
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.stations[0].current, null);
    assert.equal(result.stations[0].scheduled[0].meal, "lunch");
    assert.equal(result.timezone, "America/New_York");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("menu request failures retain unavailable reason without inferring closure", async () => {
  const source = {
    getPeriods: provider().getPeriods,
    getMenu: async (): Promise<Menu> => {
      throw Error("offline");
    },
  };
  const result = await new MenuService(
    DEFAULT_SCHEDULES,
    source,
  ).getCurrentMenu("broward", ["Gator Grill"], at("2026-10-14", "12:00"));

  assert.equal(result.stations[0].status, "unknown");
  assert.equal(result.stations[0].current?.reason, "UPSTREAM_FAILURE");
});
