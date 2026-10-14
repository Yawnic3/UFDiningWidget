export const DINING_API_BASE = "https://apiv4.dineoncampus.com";

export const DINING_HALLS = {
  "gator-corner": {
    stations: [
      "Homestyle",
      "500 Degrees",
      "Grill Works",
      "Delicious Without",
      "Global Flame",
    ],
    name: "Gator Corner",
    locationId: "62a8c2b8a9f13a0de3af64c4",
  },
  broward: {
    stations: ["Taste of Home", "Delicious Without", "Gator Grill"],
    name: "Broward Dining",
    locationId: "62b9907ab63f1e08defdd0bb",
  },
} as const;

export type DiningHall = keyof typeof DINING_HALLS;
