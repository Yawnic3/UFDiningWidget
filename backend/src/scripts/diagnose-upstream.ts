import { DINING_HALLS } from "../config/dining.config.js";
import { DiningService } from "../services/dining.service.js";
import { isDate, localParts } from "../services/meal-selection.service.js";
import { ApiError } from "../types/dining.types.js";

const date = process.argv[2] ?? localParts(new Date()).date;

if (!isDate(date)) {
  console.error("Use npm run diagnose:upstream -- YYYY-MM-DD");
  process.exitCode = 1;
} else {
  const source = new DiningService(async (input, options) => {
    const response = await fetch(input, options);

    // Inspect only non-sensitive transport metadata, never cookies or food bodies.
    console.log(
      JSON.stringify(
        {
          url: String(input),
          status: response.status,
          server: response.headers.get("server"),
          contentType: response.headers.get("content-type"),
          redirected: response.redirected,
        },
        null,
        2,
      ),
    );

    return response;
  });

  for (const hall of Object.values(DINING_HALLS)) {
    try {
      const result = await source.getPeriods(hall.locationId, date);
      console.log(
        JSON.stringify(
          {
            hall: hall.name,
            date,
            periods: result.periods.map((period) => ({
              id: period.id,
              name: period.name,
            })),
            embeddedMenuAvailable: Boolean(result.menu),
          },
          null,
          2,
        ),
      );
    } catch (error) {
      const failure =
        error instanceof ApiError
          ? error
          : new ApiError(502, "UPSTREAM_FAILURE", "Upstream request failed.");
      console.error(
        JSON.stringify(
          {
            hall: hall.name,
            code: failure.code,
            upstreamStatus: failure.upstreamStatus,
            message: failure.message,
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
    }
  }
}
