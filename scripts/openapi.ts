import { writeFileSync } from "node:fs";
import { buildOpenApi } from "../src/api/openapi";

// Regenerates docs/openapi.json, the copy to import into API tooling. tests/openapi.test.ts fails if it is stale.
writeFileSync(new URL("../docs/openapi.json", import.meta.url), JSON.stringify(buildOpenApi(), null, 2) + "\n");
console.log("wrote docs/openapi.json");
