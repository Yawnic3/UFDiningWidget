# Gator Eats

A small UF dining-menu API and native iOS widget source. The API returns food item names only, grouped by dining hall, station, and meal.

## Start and test

Requires Node.js 22 or newer.

```powershell
cd backend
npm ci
npm run dev
```

The default port is 3000. Set `PORT` to change it.

```powershell
npm test
npm run typecheck
npm run build
npm start
```

## Endpoints

All endpoints use GET. No authentication or request body is needed.

| Endpoint | Purpose |
| --- | --- |
| `/api/health` | Process health; does not promise upstream availability |
| `/api/menu/stations` | Supported halls and stations |
| `/api/menu/current?hall=broward&stations=Taste%20of%20Home,Gator%20Grill` | Current and next service, separately for each station |
| `/api/menu?hall=gator-corner&stations=Homestyle&date=2026-10-17&meal=lunch` | Explicit future date and meal |
| `/api/menu?hall=broward&stations=Taste%20of%20Home&meal=dinner` | Today's dinner |
| `/api/menu?hall=broward&stations=Taste%20of%20Home&date=2026-10-17` | All scheduled meals for that date |

Use `http://localhost:3000` before each path. Explicit dates must be today or later in **America/New_York**. Replace example dates when they have passed. Meal values are breakfast, lunch, and dinner. `/api/menu/current` also accepts date and meal parameters.

At least one station is required. Matching trims whitespace and ignores case. Unknown halls or stations, invalid dates, past dates, and invalid meals return HTTP 400.

## Station service response

The station-aware schema replaces the former single hall-wide `meal` response. Consumers should read each station's own service periods.

```text
hall: dining hall name
date: requested date or today's New York date
timezone: America/New_York
queryMode: current | scheduled
nextTransitionAt: ISO timestamp or null
stations:
  name: selected station
  status: serving | closed | unknown | scheduled
  current: service period or null
  next: next scheduled service period or null
  scheduled: requested service periods (explicit queries only)
```

Each service period contains `meal`, `date`, `startsAt`, `endsAt`, `scheduleSource` (`configured`, `provisional`, or `live`), `availability` (`available` or `unavailable`), and `items`, a string array of food names. An unavailable period also has a `reason`. No nutrition, ingredients, allergens, or dietary fields are returned.

`current` is populated only while the New York clock is inside a service window. At 16:00, Broward Taste of Home has `current: null` and a separate dinner `next`; Gator Grill and Delicious Without have current lunch. At 17:00 the continuous stations switch to dinner. Explicit queries place requested menus in `scheduled`; they never claim a future or ended meal is current.

Empty or missing food data does **not** imply closure. A station inside a scheduled window without menu data has `status: unknown`, an unavailable current period, and no invented items. `closed` follows schedule gaps or explicit live closure metadata. No current food items are shown for a closed station; upcoming food, when published, appears under its separate `next` period.

Upstream outages return schedule information with unavailable menus and reason `UPSTREAM_FAILURE`. Structurally invalid or mismatched menus return HTTP 502. HTTP errors use `{ "error": { "code": "...", "message": "..." } }`.

Unavailable upstream requests also include a diagnostic `message` and, for HTTP failures, `upstreamStatus` (for example, 403). The supplied Gator Corner periods payload is covered by a regression fixture: embedded breakfast is reused, actual item order is preserved, and nutrition fields are discarded. An explicit meal query fetches only that meal's menu.

HTTP 401/403 is reported as `UPSTREAM_ACCESS_DENIED`, with `upstreamStatus`, an actionable message, and `retryAt`. A 60-second cooldown per location prevents repeated blocked requests across dates and meals. Successful unexpired cached menus can still be used; ordinary outages do not enter this access-denial cooldown.

To diagnose requests from the same terminal as your backend:

```powershell
npm run diagnose:upstream
# Or inspect a specific date:
npm run diagnose:upstream -- 2026-10-14
```

This prints the requested URL, HTTP status, server and content-type headers, redirects, and published period IDs when available. It never prints cookies or nutrition fields. A direct request returning 403 while Chrome succeeds indicates different treatment of the backend request; the response alone does not identify whether the provider requires authorized credentials, permitted client headers, or other server-access approval. Confirm the allowed integration method with Dine On Campus. Do not copy browser session credentials or treat a hardcoded period ID as an access fix.

## Built-in schedules

All selection uses the **America/New_York** local date, weekday, and time, independently of the server or device timezone. API timestamps are serialized as UTC ISO instants for interoperability; UTC clock hours never decide which meal is served. Windows include their start and exclude their end.

| Hall / station | Monday–Friday | Saturday–Sunday |
| --- | --- | --- |
| Broward: Taste of Home | Breakfast 07:00–10:00; lunch 11:00–15:00; dinner 17:00–21:00 | Breakfast 08:30–10:45; lunch 11:00–15:00; dinner 17:00–21:00 |
| Broward: Delicious Without, Gator Grill | Lunch 11:00–17:00; dinner 17:00–21:00; no breakfast | Same |
| Gator Corner: all five supported stations | **Provisional** breakfast 07:00–11:00; lunch 11:00–17:00; dinner 17:00–21:00 | **Provisional** breakfast 08:30–11:00; lunch 11:00–17:00; dinner 17:00–21:00 |

These defaults implement the user's supplied schedule. Broward Taste of Home is closed between its listed windows. Other Broward stations have continuous lunch/dinner service. Corner defaults stay within the supplied weekday building hours of 07:00–21:00 and weekend hours of 08:30–21:00. Corner station-specific meal availability remains unverified: only an actual published station menu makes food available.

Selection precedence:

1. Explicit configured hall/date overrides, then station/date overrides, for known holidays or unusual hours.
2. Validated live station times and explicit closure metadata.
3. Live meal-period times. For provisional Corner windows, these replace fallback times; a meal omitted from a nonempty live periods response is not invented. For Broward, hall-wide periods can narrow station service but cannot reopen Taste of Home during a known gap.
4. Configured weekday windows, marked provisional when applicable.

An entirely empty live periods response remains unavailable data rather than proof of a holiday closure. Automatic queries look ahead through seven days for scheduled station service; the next menu may still be unpublished.

## Custom schedules and holidays

Defaults are in `backend/src/config/default-schedules.config.ts`. Optionally supply a complete JSON configuration with `MEAL_SCHEDULE_FILE`; it replaces the defaults. `week` keys are Sunday `0` through Saturday `6`. Entries must be ordered, non-overlapping, and use HH:MM. Meal names cannot repeat within a day. Missing weekday entries and empty arrays represent no configured service.

```json
{
  "broward": {
    "week": {},
    "dates": { "2026-12-25": [] },
    "stations": {
      "Taste of Home": {
        "week": {
          "1": [
            { "meal": "breakfast", "start": "07:00", "end": "10:00" },
            { "meal": "lunch", "start": "11:00", "end": "15:00" },
            { "meal": "dinner", "start": "17:00", "end": "21:00" }
          ]
        },
        "dates": {
          "2026-12-24": [
            { "meal": "lunch", "start": "11:00", "end": "14:00" }
          ]
        },
        "provisional": false
      }
    }
  },
  "gator-corner": {
    "week": {},
    "stations": {
      "Homestyle": { "week": {}, "provisional": true }
    }
  }
}
```

This partial example deliberately configures only one weekday at one station. Copy all needed days and stations from the defaults for a complete operating schedule. Legacy hall-wide `week` arrays are still accepted as a fallback when station configuration is absent. A hall date override applies to every selected station and takes priority over station dates.

```powershell
$env:MEAL_SCHEDULE_FILE = 'C:\absolute\path\to\schedules.json'
npm run dev
```

Restart after editing schedules.

## Upstream integration and cache

Dine On Campus period IDs are fetched dynamically. Embedded menus are reused. Requests use native fetch, Accept: application/json, and a 10-second timeout. Menus retain upstream station names and food order; food names are trimmed.

The adapter currently recognizes explicit `start` / `end` fields in HH:MM and boolean `isClosed` on periods and station categories. These optional fields are a validated adapter contract, **not a claim that production uses those field names**. Production responses remain inaccessible for verification; adapt only from documented or inspected real fields before deployment. Unsupported timing fields are ignored and the response labels configured/provisional timing honestly. No browser visitor ID or access-control bypass is used.

Raw responses are cached for five minutes by location, date, and meal period, with concurrent request deduplication and a 256-entry bound. No yesterday-to-today relabeling or stale fallback is used. The scheduler never relabels an ended menu as current.

## iOS setup on a Mac

Swift source is prepared; native compilation and visual layout have **not** been tested in this Windows environment.

1. Create an iOS SwiftUI App targeting iOS 17 or later.
2. Add a Widget Extension using App Intents. Remove generated widget and intent implementations.
3. Add `ios/MenuShared.swift` to both targets.
4. Add `ios/GatorEatsApp.swift` only to the app target, replacing its generated entry point.
5. Add `ios/GatorEatsWidget.swift` only to the widget target. Each target must have one `@main` entry point.
6. In both targets, set the String Info.plist key `GatorEatsAPIBaseURL` to your reachable HTTPS backend base URL.
7. Register the `gatoreats` URL scheme in the application target.
8. Build both targets, then add a medium Home Screen or rectangular Lock Screen widget. Use Edit Widget to select a hall and stations.

The Swift response model reads each station's current/next state and labels upcoming meals separately. The medium widget shows up to two stations and three foods per station. Tap for the full menu. WidgetKit controls exact refresh timing; the provider requests refresh at the earlier of the next transition or 15 minutes and expires outdated entries at meal boundaries.

Before release, test VoiceOver, text sizes, long names, mixed current/next station states, holiday closures, deep links, unavailable data, and transitions on a real device.

## Remaining external blockers

- Live API requests returned HTTP 403 during the earlier October 14, 2026 access check. Permitted API access requirements remain unconfirmed.
- Gator Corner station-specific availability and production timing field names remain unverified.
- Automated access and redistribution permission remain unconfirmed. Obtain applicable provider terms before public launch. The [Chartwells terms page](https://chartwellshighered.com/terms-of-use/) did not expose substantive terms to the research tool.
- Native iOS compilation requires Xcode on a Mac.
