import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import type { ConfigFile } from "@/backend/config/ConfigFile";
import { ServiceMonitorRepository } from "@/backend/storage/ServiceMonitorRepository";

import type {
  ServiceMonitorState,
  ServiceMonitorStatus,
} from "@/definition/ServiceMonitor";

const execute = promisify(execFile);
const WINDOW_MS = 10 * 60_000;
const STALE_MS = 30_000;

interface UnitCounter {
  readonly unit: string;
  readonly restarts: number;
}

/** Observes systemd independently and serves retained warnings without calling the affected service. */
export class ServiceMonitorService {
  private readonly configFile: ConfigFile;

  /** Shares only the protected configuration and local warning store with the application. */
  public constructor(configFile: ConfigFile) {
    this.configFile = configFile;
  }

  /** Reads settings diagnostics; callers must authorize the administrator before calling. */
  public async readStatus(): Promise<ServiceMonitorStatus> {
    try {
      const stored = await (await this.repository()).read();
      if (!stored)
        return { state: "unavailable", checkedAt: null, warnings: [] };
      return {
        state: Date.now() - stored.checkedAt > STALE_MS ? "stale" : "ok",
        checkedAt: stored.checkedAt,
        warnings: stored.warnings,
      };
    } catch {
      // A broken or inaccessible monitor store is itself visible; it must never appear healthy.
      return { state: "unavailable", checkedAt: null, warnings: [] };
    }
  }

  /** Samples manager-owned restart counters, retaining evidence across monitor and API restarts. */
  public async observe(
    units: readonly string[],
    isUserScope: boolean,
  ): Promise<void> {
    if (
      units.length === 0 ||
      units.length > 16 ||
      units.some((unit) => !/^[a-zA-Z0-9@_.-]+\.service$/u.test(unit))
    )
      throw new Error("Invalid monitored service units");
    const repository = await this.repository();
    const previous = await repository.read();
    const counters = await Promise.all(
      units.map((unit) => this.readCounter(unit, isUserScope)),
    );
    await repository.write(nextCheckpoint(previous, counters));
  }

  private async repository(): Promise<ServiceMonitorRepository> {
    const config = await this.configFile.read();
    if (!config || config.firstRun)
      throw new Error("Service monitoring requires completed setup");
    return new ServiceMonitorRepository(path.dirname(config.databasePath));
  }

  private async readCounter(
    unit: string,
    isUserScope: boolean,
  ): Promise<UnitCounter> {
    const { stdout } = await execute(
      "/usr/bin/systemctl",
      [
        ...(isUserScope ? ["--user"] : []),
        "show",
        unit,
        "--property=LoadState",
        "--property=NRestarts",
      ],
      { timeout: 3000, maxBuffer: 4096 },
    );
    const match = /^NRestarts=(\d+)$/mu.exec(stdout);
    if (!/^LoadState=loaded$/mu.test(stdout) || !match?.[1])
      throw new Error(`Cannot read restart state for ${unit}`);
    const restarts = Number(match[1]);
    if (!Number.isSafeInteger(restarts))
      throw new Error("Invalid systemd restart counter");
    return { unit, restarts };
  }
}

function nextCheckpoint(
  previous: ServiceMonitorState | null,
  counters: readonly UnitCounter[],
): ServiceMonitorState {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const warnings = new Map(
    previous?.warnings.map((warning) => [warning.unit, warning]),
  );
  const units = counters.map((counter) => {
    const before = previous?.units.find((entry) => entry.unit === counter.unit);
    const events = before?.events.filter((event) => event.at > cutoff) ?? [];
    if (before && previous && previous.checkedAt > cutoff) {
      const delta =
        counter.restarts >= before.restarts
          ? counter.restarts - before.restarts
          : counter.restarts;
      // Attribute a sampled increment to its lower time bound, avoiding false ten-minute claims.
      if (delta > 0) events.push({ at: previous.checkedAt, count: delta });
    }
    const count = events.reduce((sum, event) => sum + event.count, 0);
    if (count > 3)
      warnings.set(counter.unit, {
        unit: counter.unit,
        count,
        detectedAt: now,
      });
    return { ...counter, events };
  });
  return { checkedAt: now, units, warnings: [...warnings.values()] };
}
