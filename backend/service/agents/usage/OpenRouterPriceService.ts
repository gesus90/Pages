import { logCaughtError } from "@/backend/logging/Logger";

import { parseOpenRouterPrices } from "./OpenRouterPrices";

import type { OpenRouterPriceRepository } from "@/backend/database/repositories/agent/OpenRouterPriceRepository";

const DAILY_MS = 24 * 60 * 60 * 1_000;

/** Refreshes the anonymous public price catalog at startup and once a day, retaining the last good copy. */
export class OpenRouterPriceService {
  private readonly repository: Pick<OpenRouterPriceRepository, "save">;
  private readonly request: typeof fetch;
  private isRunning = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  public constructor(
    repository: Pick<OpenRouterPriceRepository, "save">,
    request: typeof fetch = fetch,
  ) {
    this.repository = repository;
    this.request = request;
  }

  /** Loads prices before starting the daily timer; network errors do not remove the persisted catalog. */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    await this.refresh();
    if (!this.isRunning) return;
    this.timer = setInterval(() => {
      void this.refresh();
    }, DAILY_MS);
    this.timer.unref();
  }

  /** Releases only this service's timer. */
  public stop(): void {
    this.isRunning = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Validates every price before replacing the stored catalog, or retains the old snapshot offline. */
  public async refresh(): Promise<void> {
    try {
      const response = await this.request(
        "https://openrouter.ai/api/v1/models",
        {
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok)
        throw new Error(`OpenRouter price catalog: HTTP ${response.status}`);
      const payload: unknown = await response.json();
      await this.repository.save(
        parseOpenRouterPrices(payload, new Date().toISOString()),
      );
    } catch (error: unknown) {
      logCaughtError("OpenRouterPriceService", error);
    }
  }
}
