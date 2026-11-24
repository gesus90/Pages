import path from "node:path";

import { resolveDefaultDataDirectory } from "@/backend/config/PagesConfig";
import { AntigravityPriceCatalog } from "@/backend/service/agents/sessions/AntigravityPriceCatalog";
import { EcbReferenceRate } from "@/backend/service/agents/sessions/EcbReferenceRate";

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

/** Creates the ECB reference rate kept in the configured Pages data directory. */
export function createReferenceRate(configPath: string): EcbReferenceRate {
  return new EcbReferenceRate(
    path.join(
      resolveDefaultDataDirectory(configPath),
      "ecb-reference-rate.json",
    ),
  );
}
