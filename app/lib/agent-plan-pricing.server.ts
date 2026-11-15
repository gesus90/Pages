import path from "node:path";

import { resolveDefaultDataDirectory } from "@/backend/config/PagesConfig";
import { OpenRouterPriceCatalog } from "@/backend/service/agents/sessions/OpenRouterPriceCatalog";

/** Creates the price catalog in the configured Pages data directory. */
export function createPriceCatalog(configPath: string): OpenRouterPriceCatalog {
  return new OpenRouterPriceCatalog(
    path.join(
      resolveDefaultDataDirectory(configPath),
      "openrouter-prices.json",
    ),
  );
}
