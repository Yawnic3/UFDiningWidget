import test from "node:test";
import assert from "node:assert/strict";
import { DINING_API_BASE, DINING_HALLS } from "../src/config/dining.config.js";
import { DEFAULT_SCHEDULES } from "../src/config/default-schedules.config.js";
import { DiningService } from "../src/services/dining.service.js";
import { MenuService } from "../src/services/menu.service.js";

// Reference IDs supplied for October 14, 2026, are fixtures only.
const references = {
  "gator-corner": "6acfd1688f48e1937de74012",
  broward: "6acfd1698f48e1937de742d7",
} as const;

for (const hall of ["gator-corner", "broward"] as const) {
  for (const id of [references[hall], "newly-published-period-id"]) {
    test(`${hall} uses the v4 periods response ID: ${id}`, async () => {
      const location = DINING_HALLS[hall].locationId;
      const station = DINING_HALLS[hall].stations[0];
      const requests: string[] = [];
      const source = new DiningService(async (input) => {
        const url = new URL(String(input));
        requests.push(url.href);

        assert.equal(url.origin, DINING_API_BASE);
        assert.equal(url.searchParams.get("date"), "2026-10-14");

        if (url.pathname.endsWith("/periods/")) {
          assert.equal(url.pathname, `/locations/${location}/periods/`);
          return Response.json({ periods: [{ id, name: "Lunch" }] });
        }

        assert.equal(url.pathname, `/locations/${location}/menu`);
        assert.equal(url.searchParams.get("period"), id);
        return Response.json({
          date: "2026-10-14",
          period: {
            id,
            name: "Lunch",
            categories: [
              {
                name: station,
                items: [{ name: " Food name ", calories: 999 }],
              },
            ],
          },
        });
      });

      const result = await new MenuService(
        DEFAULT_SCHEDULES,
        source,
      ).getCurrentMenu(hall, [station], new Date("2026-10-14T12:00:00-04:00"), {
        date: "2026-10-14",
        meal: "lunch",
      });

      assert.equal(
        requests[0],
        `${DINING_API_BASE}/locations/${location}/periods/?date=2026-10-14`,
      );
      assert.equal(
        requests[1],
        `${DINING_API_BASE}/locations/${location}/menu?date=2026-10-14&period=${id}`,
      );
      assert.deepEqual(result.stations[0].scheduled?.[0].items, ["Food name"]);
      assert.ok(!JSON.stringify(result).includes("calories"));
    });
  }
}

test("default upstream date follows New York rather than UTC midnight", async () => {
  const dates: string[] = [];
  const service = new DiningService(
    async (input) => {
      dates.push(new URL(String(input)).searchParams.get("date")!);
      return Response.json({ periods: [] });
    },
    300_000,
    () => Date.parse("2026-10-15T02:00:00Z"),
  );

  await service.getPeriods(DINING_HALLS.broward.locationId);
  assert.deepEqual(dates, ["2026-10-14"]);
});

test("missing periods never trigger requests using reference IDs", async () => {
  const requests: string[] = [];
  const source = new DiningService(async (input) => {
    requests.push(String(input));
    return Response.json({ periods: [] });
  });

  const result = await new MenuService(
    DEFAULT_SCHEDULES,
    source,
  ).getCurrentMenu(
    "broward",
    ["Taste of Home"],
    new Date("2026-10-14T12:00:00-04:00"),
    { date: "2026-10-14", meal: "lunch" },
  );

  assert.equal(requests.length, 1);
  assert.equal(result.stations[0].scheduled?.[0].availability, "unavailable");
  assert.deepEqual(result.stations[0].scheduled?.[0].items, []);
});

test("URL construction validates dates and encodes period IDs", async () => {
  const service = new DiningService(async (input) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("period"), "id&other=value");
    assert.equal(url.searchParams.get("other"), null);
    return Response.json({
      period: {
        id: "id&other=value",
        name: "Lunch",
        categories: [{ name: "Homestyle", items: [{ name: "Food" }] }],
      },
    });
  });

  await service.getMenu("location", "2026-10-14", "id&other=value");
  await assert.rejects(service.getPeriods("location", "2026-02-30"), {
    code: "INVALID_DATE",
  });
  await assert.rejects(service.getMenu("location", "2026-10-14", ""), {
    code: "MEAL_UNAVAILABLE",
  });
});

test("user-provided Gator Corner payload parses and reuses embedded breakfast", async () => {
  const { readFile } = await import("node:fs/promises");
  const payload: unknown = JSON.parse(
    await readFile(
      new URL("./fixtures/gator-corner-periods.json", import.meta.url),
      "utf8",
    ),
  );
  const requests: string[] = [];
  const source = new DiningService(async (input) => {
    requests.push(String(input));
    return Response.json(payload);
  });

  const result = await new MenuService(
    DEFAULT_SCHEDULES,
    source,
  ).getCurrentMenu(
    "gator-corner",
    ["Homestyle", "500 Degrees", "Grill Works"],
    new Date("2026-10-14T08:00:00-04:00"),
    { date: "2026-10-14", meal: "breakfast" },
  );

  // A breakfast query reuses the embedded menu and fetches no other meals.
  assert.equal(requests.length, 1);
  assert.ok(
    !requests.some((url) => url.includes("period=6acfdf7b3860dda1817184c5")),
  );
  assert.deepEqual(result.stations[0].scheduled?.[0].items, [
    "Bruschetta Egg Scramble",
    "Apple Danish",
    "Turmeric Fried Potatoes",
    "Turkey Sausage Patty",
    "Toasted Oatmeal, Banana, Honey",
  ]);
  assert.equal(result.stations[1].scheduled?.[0].availability, "available");
  assert.equal(
    result.stations[2].scheduled?.[0].items[0],
    "Chocolate Chip Muffin",
  );
  assert.ok(!JSON.stringify(result).includes("calories"));
});

test("HTTP 403 remains visible in unavailable station diagnostics", async () => {
  const source = new DiningService(
    async () => new Response(".", { status: 403 }),
  );
  const result = await new MenuService(
    DEFAULT_SCHEDULES,
    source,
  ).getCurrentMenu(
    "broward",
    ["Gator Grill"],
    new Date("2026-10-14T16:00:00-04:00"),
    { date: "2026-10-14", meal: "lunch" },
  );

  const meal = result.stations[0].scheduled?.[0];
  assert.equal(meal?.reason, "UPSTREAM_ACCESS_DENIED");
  assert.equal(meal?.upstreamStatus, 403);
  assert.match(meal?.message ?? "", /Confirm permitted server access/);
  assert.ok(meal?.retryAt);
  assert.deepEqual(meal?.items, []);
});

test("access denial has a per-location cooldown, expires, and can recover", async () => {
  let calls = 0;
  let time = 0;
  let allowed = false;
  const source = new DiningService(
    async () => {
      calls++;
      return allowed
        ? Response.json({ periods: [] })
        : new Response(".", { status: 403 });
    },
    300_000,
    () => time,
  );

  await assert.rejects(source.getPeriods("hall-one", "2026-10-14"), {
    code: "UPSTREAM_ACCESS_DENIED",
    upstreamStatus: 403,
  });
  await assert.rejects(source.getPeriods("hall-one", "2026-10-15"), {
    code: "UPSTREAM_ACCESS_DENIED",
  });
  await assert.rejects(source.getMenu("hall-one", "2026-10-14", "lunch"), {
    code: "UPSTREAM_ACCESS_DENIED",
  });
  assert.equal(calls, 1);

  await assert.rejects(source.getPeriods("hall-two", "2026-10-14"), {
    code: "UPSTREAM_ACCESS_DENIED",
  });
  assert.equal(calls, 2);

  time = 60_001;
  allowed = true;
  assert.deepEqual(await source.getPeriods("hall-one", "2026-10-14"), {
    periods: [],
    menu: undefined,
  });
  assert.equal(calls, 3);
});
