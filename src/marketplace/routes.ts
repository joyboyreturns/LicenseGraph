import { ROUTE_SPECS } from "./contract";

/** Private workspace endpoints, grouped by path. Kept explicit so discovery and route coverage can verify them. */
export const MARKETPLACE_ROUTES = [...new Set(ROUTE_SPECS.map((spec) => spec.path))].map((path) => {
  const specs = ROUTE_SPECS.filter((spec) => spec.path === path);
  return { path, methods: specs.map((spec) => spec.method), summary: specs[0]!.summary, ...(specs.every((spec) => spec.auth === "public") ? { public: true as const } : {}) };
});
