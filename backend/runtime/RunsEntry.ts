import path from "node:path";

import { getApplicationServices } from "@/app/lib/services.server";
import { initializeLogging, logEvent } from "@/backend/logging/Logger";

import { canProcessRuns, enterRunsProcess } from "./RunsMode";
import { hasServiceProgress } from "./ServiceWorkHealth";
import { startServiceWatchdog } from "./ServiceWatchdog";
import { initializePagesRuntime } from "./PagesRuntime";
import { installProcessLogging, shutdownProcess } from "./ProcessLifecycle";

/** Standalone plan scheduler; no HTTP application listener or integration delivery. */
export async function startRuns(
  argumentList: readonly string[],
): Promise<void> {
  installProcessLogging();
  try {
    const configPath = runsConfigPath(argumentList);
    enterRunsProcess();
    await initializeLogging(configPath);
    const runtime = await initializePagesRuntime(configPath);
    const config = runtime.getConfig();
    if (
      config.firstRun ||
      !config.databaseUrl ||
      config.runsMode !== "separate"
    )
      throw new Error(
        "pages-runs requires completed setup and runsMode = separate.",
      );
    const services = await getApplicationServices();
    startServiceWatchdog(
      async () =>
        canProcessRuns() &&
        hasServiceProgress(["runs.commands"]) &&
        (await services.healthService.canQueryDatabase()),
    );
    logEvent({
      level: "info",
      event: "runs.started",
      component: "RunsEntry",
      message: "Standalone plan engine and command inbox started",
    });
  } catch (error: unknown) {
    await shutdownProcess(1, "runs_startup", error);
  }
}

function runsConfigPath(argumentList: readonly string[]): string {
  if (
    argumentList.length !== 2 ||
    argumentList[0] !== "--config" ||
    !argumentList[1] ||
    !path.isAbsolute(argumentList[1])
  )
    throw new Error(
      "Usage: node pages-runs.mjs --config /absolute/config.toml",
    );
  return argumentList[1];
}
