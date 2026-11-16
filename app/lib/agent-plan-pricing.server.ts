import path from "node:path";

import { resolveDefaultDataDirectory } from "@/backend/config/PagesConfig";
import { AntigravityPriceCatalog } from "@/backend/service/agents/sessions/AntigravityPriceCatalog";

/** Creates the price catalog in the configured Pages data directory. */
export function createPriceCatalog(
  configPath: string,
): AntigravityPriceCatalog {
  return new AntigravityPriceCatalog(
    path.join(
      resolveDefaultDataDirectory(configPath),
      "antigravity-openrouter-prices.json",
    ),
  );
}
