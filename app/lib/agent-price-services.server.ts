import { OpenRouterPriceRepository } from "@/backend/database/repositories/agent/OpenRouterPriceRepository";
import { OpenRouterPriceService } from "@/backend/service/agents/usage/OpenRouterPriceService";
import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";
import { canProcessApiWork } from "@/backend/runtime/RunsMode";

import type { Database } from "@/backend/database/Database";

/** Starts periodic OpenRouter model price synchronization and registers shutdown cleanup. */
export function startOpenRouterPrices(database: Database): void {
  if (!canProcessApiWork()) return;
  const prices = new OpenRouterPriceService(
    new OpenRouterPriceRepository(database),
  );
  void prices.start();
  registerShutdownTask(
    async () => {
      prices.stop();
    },
    { step: "openrouter_prices" },
  );
}
