import path from "node:path";

import { ConfigFile } from "@/backend/config/ConfigFile";
import { resolveAgentsDirectory } from "@/backend/config/PagesConfig";
import { Database } from "@/backend/database/Database";
import { GitHubJobRepository } from "@/backend/database/repositories/integrations/GitHubJobRepository";
import { LiveChangeNotificationRepository } from "@/backend/database/repositories/LiveChangeNotificationRepository";
import { resolveGitHubTokenKey } from "@/backend/github/GitHubTokenKey";
import { initializeLogging, logEvent } from "@/backend/logging/Logger";
import { GitHubJobWorker } from "@/backend/service/integrations/GitHubJobWorker";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import { forwardLiveChanges } from "@/backend/service/events/LiveChangeRelay";
import { createIntegrationServices } from "@/backend/service/integrations/IntegrationServices";
import { createIntegrationRunAccess } from "@/backend/service/integrations/IntegrationRunAccess";
import { createIntegrationFcmConsumer } from "@/backend/service/integrations/IntegrationFcmConsumer";
import {
  canProcessIntegrations,
  claimIntegrationProcessing,
  stopIntegrationProcessing,
} from "@/backend/service/integrations/IntegrationProcessing";

import {
  installProcessLogging,
  registerShutdownTask,
  shutdownProcess,
} from "./ProcessLifecycle";
import { hasServiceProgress } from "./ServiceWorkHealth";
import { startServiceWatchdog } from "./ServiceWatchdog";

/** Standalone GitHub/FCM entrypoint. It opens no application listener and starts no agent engine. */
export async function startIntegrations(
  argumentList: readonly string[],
): Promise<void> {
  installProcessLogging();
  try {
    const configPath = integrationConfigPath(argumentList);
    const config = await new ConfigFile(configPath).read();
    if (
      !config ||
      config.firstRun ||
      !config.databaseUrl ||
      config.integrationsMode !== "separate"
    )
      throw new Error(
        "pages-integrations requires completed setup and integrationsMode = separate.",
      );
    await initializeLogging(configPath);
    if (!(await claimIntegrationProcessing(config, "separate")))
      throw new Error("Another process already owns integration delivery.");
    const directory = path.dirname(config.databasePath);
    const database = await Database.connect(config.databaseUrl, directory);
    // Only the API server migrates. A mismatched schema fails before any delivery starts.
    const jobs = new GitHubJobRepository(database);
    const tokenKey = resolveGitHubTokenKey(config.databasePath, {
      allowCreate: false,
    });
    // Only the API process serves the live view; this process relays what it changed.
    const events = new PagesEventPublisher(database);
    forwardLiveChanges(events, new LiveChangeNotificationRepository(database));
    const services = createIntegrationServices(database, directory, tokenKey, {
      events,
    });
    const runs = createIntegrationRunAccess({
      database,
      directory,
      tokenKey,
      services,
      agentsDirectory: resolveAgentsDirectory(configPath),
    });
    const github = new GitHubJobWorker({
      jobs,
      github: services.github,
      users: services.userRepository,
      tasks: services.tasks,
    });
    const fcm = createIntegrationFcmConsumer({
      database,
      config,
      tokenKey,
      users: services.users,
      runs,
    });
    registerShutdownTask(
      async () => {
        stopIntegrationProcessing();
        await Promise.all([github.stop(), fcm.stop()]);
        await database.close();
        // FCM's bounded stop can leave a request in flight. Keep ownership until process exit.
      },
      { step: "integrations_drain", budgetMs: 25_000 },
    );
    await github.start();
    fcm.start();
    startServiceWatchdog(async () => {
      if (
        !canProcessIntegrations() ||
        !hasServiceProgress(["integrations.github", "integrations.fcm"])
      )
        return false;
      await database.query("SELECT 1 AS alive;");
      return true;
    });
    logEvent({
      level: "info",
      event: "integrations.started",
      component: "IntegrationsEntry",
      message: "Standalone GitHub and FCM processing started",
    });
  } catch {
    logEvent({
      level: "fatal",
      event: "integrations.start.failed",
      component: "IntegrationsEntry",
      message:
        "Integration service could not start; verify mode, schema, ownership and protected configuration",
    });
    await shutdownProcess(1, "integrations_startup");
  }
}

function integrationConfigPath(argumentList: readonly string[]): string {
  if (
    argumentList.length !== 2 ||
    argumentList[0] !== "--config" ||
    !argumentList[1] ||
    !path.isAbsolute(argumentList[1])
  )
    throw new Error(
      "Usage: node pages-integrations.mjs --config /absolute/config.toml",
    );
  return argumentList[1];
}
