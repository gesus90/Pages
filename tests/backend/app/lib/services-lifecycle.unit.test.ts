import { OpenRouterPrices } from "@/backend/service/agents/sessions/OpenRouterPrices";
import { beforeEach, expect, it, vi } from "vitest";

import {
  DATABASE_PATH,
  runtimeFixture,
  servicesWorld,
} from "./services-fixture";
import {
  activateApplicationServices,
  getApplicationServices,
} from "@/app/lib/services.server";
import { createAgentPlanService } from "@/app/lib/agent-plan-services.server";
import { createChatServices } from "@/app/lib/chat-services.server";
import { Database } from "@/backend/database/Database";
import { GitHubJobWorker } from "@/backend/service/integrations/GitHubJobWorker";
import {
  logCaughtError,
  logDiagnostic,
  logEvent,
} from "@/backend/logging/Logger";
import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import { PagesEventRetention } from "@/backend/service/events/PagesEventRetention";
import { WikiService } from "@/backend/service/WikiService";
import { TaskAttachmentService } from "@/backend/service/task/TaskAttachmentService";
import { WikiMaintenanceScheduler } from "@/backend/service/wiki/WikiMaintenanceScheduler";

import type { ServicesWorld } from "./services-fixture";

let world: ServicesWorld;

/** The shutdown task registered in that position: GitHub scheduler, services, wiki maintenance. */
function shutdownTask(index: 0 | 1 | 2): () => Promise<void> {
  expect(registerShutdownTask).toHaveBeenCalledTimes(3);
  return vi.mocked(registerShutdownTask).mock.calls[index][0];
}

beforeEach(() => {
  vi.resetAllMocks();
  world = servicesWorld();
  vi.spyOn(OpenRouterPrices.prototype, "start").mockResolvedValue();
  vi.mocked(GitHubJobWorker.prototype.start).mockResolvedValue(undefined);
});

it("opens the configured database once and shares the services of the process", async () => {
  const first = getApplicationServices();
  const second = getApplicationServices();

  expect(second).toBe(first);
  await expect(first).resolves.toMatchObject(world.agents);
  expect(Database.connect).toHaveBeenCalledOnce();
  expect(Database.connect).toHaveBeenCalledWith(
    "postgresql://localhost/pages",
    "/srv/pages/data",
  );
  expect(vi.mocked(logEvent).mock.calls.map(([event]) => event.event)).toEqual([
    "services.initialization.started",
    "services.initialization.completed",
  ]);
});

it("forgets a failed start so a later request can try again", async () => {
  const failure = new Error("setup pending");
  vi.mocked(Database.connect).mockRejectedValueOnce(failure);

  await expect(getApplicationServices()).rejects.toBe(failure);

  expect(logCaughtError).toHaveBeenCalledWith("services", failure);
  expect(globalThis.pagesServices).toBe(undefined);
  await expect(getApplicationServices()).resolves.toMatchObject(world.agents);
  expect(Database.connect).toHaveBeenCalledTimes(2);
});

it("shuts the agents down before the database closes", async () => {
  await activateApplicationServices(world.database, DATABASE_PATH);

  await shutdownTask(1)();

  expect(world.shutdownSteps).toEqual([
    "chat requests",
    "plans",
    "acp resources",
    "catalog scheduler",
    "tool manager",
    "tool startup",
    "cli login",
    "remote console",
    "remote sessions",
    "ssh client",
    "database",
  ]);
  expect(logCaughtError).not.toHaveBeenCalled();
});

it("releases agent resources even when the plans fail to shut down", async () => {
  const failure = new Error("plans did not stop");
  world.shutdownStep("plans").mockRejectedValueOnce(failure);
  await activateApplicationServices(world.database, DATABASE_PATH);

  await expect(shutdownTask(1)()).rejects.toBe(failure);

  expect(world.shutdownSteps).toEqual([
    "chat requests",
    "acp resources",
    "catalog scheduler",
    "tool manager",
    "tool startup",
    "cli login",
    "remote console",
    "remote sessions",
    "ssh client",
    "database",
  ]);
  const attemptedSteps = [
    "chat requests",
    "plans",
    "acp resources",
    "catalog scheduler",
    "tool manager",
    "tool startup",
    "cli login",
    "remote console",
    "remote sessions",
    "ssh client",
    "database",
  ].map((name) => world.shutdownStep(name));
  expect(attemptedSteps.every((step) => step.mock.calls.length === 1)).toBe(
    true,
  );
  const invocationOrder = attemptedSteps.map(
    (step) => step.mock.invocationCallOrder[0],
  );
  expect(invocationOrder).toEqual(
    [...invocationOrder].sort((left, right) => left - right),
  );
  expect(world.database.close).toHaveBeenCalledOnce();
  const events = vi.mocked(logEvent).mock.calls.map(([event]) => event);
  expect(
    events.filter(({ event }) => event === "server.shutdown.step_failed"),
  ).toEqual([
    expect.objectContaining({
      level: "error",
      error: failure,
      metadata: { step: "plans" },
    }),
  ]);
  expect(
    events.filter(({ event }) => event === "server.shutdown.database_close"),
  ).toEqual([
    expect.objectContaining({
      level: "info",
      metadata: { databaseClose: "closed" },
    }),
  ]);
  // The step event is the only report, and the database did close: nothing may
  // describe the failed step as a failed close.
  expect(logCaughtError).not.toHaveBeenCalled();
  expect(logDiagnostic).not.toHaveBeenCalledWith(
    "services",
    "error",
    "[pages] Closing the database failed.",
    failure,
  );
});

it("registers the shutdown and the schedulers once per process", async () => {
  await activateApplicationServices(world.database, DATABASE_PATH);
  await activateApplicationServices(world.database, DATABASE_PATH);

  expect(registerShutdownTask).toHaveBeenCalledTimes(3);
  expect(GitHubJobWorker).toHaveBeenCalledTimes(2);
  expect(GitHubJobWorker.prototype.start).toHaveBeenCalledOnce();
  expect(WikiMaintenanceScheduler.prototype.start).toHaveBeenCalledOnce();
  expect(globalThis.pagesShutdownHandlerRegistered).toBe(true);
  expect(globalThis.pagesGitHubWorkerStarted).toBeDefined();
  expect(globalThis.pagesWikiMaintenanceStarted).toBe(true);
});

it("stops the GitHub synchronization and the wiki maintenance on shutdown", async () => {
  await activateApplicationServices(world.database, DATABASE_PATH);

  await shutdownTask(0)();
  expect(GitHubJobWorker.prototype.stop).toHaveBeenCalledOnce();
  await shutdownTask(2)();
  expect(WikiMaintenanceScheduler.prototype.stop).toHaveBeenCalledOnce();
  expect(world.shutdownSteps).toEqual([]);
});

it("cleans up the wiki, then the agent assets, then consumed outbox events, then expired agent deletions in each maintenance run", async () => {
  await activateApplicationServices(world.database, DATABASE_PATH);
  vi.mocked(WikiService.prototype.runMaintenance).mockResolvedValue([]);
  // The maintenance runs as one announced call of the publisher.
  vi.mocked(PagesEventPublisher.prototype.announce).mockImplementation(
    async (work) => work(),
  );
  const retention = vi
    .spyOn(PagesEventRetention.prototype, "runOnce")
    .mockResolvedValue(JSON.parse("{}"));

  const [{ runMaintenance }] = vi.mocked(WikiMaintenanceScheduler).mock
    .calls[0];
  await runMaintenance();

  expect(WikiService.prototype.runMaintenance).toHaveBeenCalledOnce();
  const assets = vi.mocked(world.mcp.agentAssetService.runMaintenance);
  expect(assets).toHaveBeenCalledOnce();
  expect(
    vi.mocked(WikiService.prototype.runMaintenance).mock.invocationCallOrder[0],
  ).toBeLessThan(assets.mock.invocationCallOrder[0]);
  expect(retention).toHaveBeenCalledOnce();
  expect(assets.mock.invocationCallOrder[0]).toBeLessThan(
    retention.mock.invocationCallOrder[0],
  );
  const deletions = vi.mocked(world.employee.agentDeletionService.purgeExpired);
  expect(deletions).toHaveBeenCalledOnce();
  expect(retention.mock.invocationCallOrder[0]).toBeLessThan(
    deletions.mock.invocationCallOrder[0],
  );
});

it("starts even when stale ticket attachments cannot be swept", async () => {
  const failure = new Error("attachments unreadable");
  vi.mocked(TaskAttachmentService.prototype.sweep).mockRejectedValue(failure);

  await expect(
    activateApplicationServices(world.database, DATABASE_PATH),
  ).resolves.toBeDefined();

  await vi.waitFor(() => {
    expect(logDiagnostic).toHaveBeenCalledWith(
      "services",
      "warn",
      "Pages could not sweep ticket attachment files.",
      failure,
    );
  });
  expect(logCaughtError).toHaveBeenCalledWith("services", failure);
});

it.each(["", "   "])(
  "reaches the instance on its loopback port when the API address is %j",
  async (configured) => {
    vi.stubEnv("PAGES_AGENT_API_URL", configured);

    await activateApplicationServices(world.database, DATABASE_PATH);

    const [input] = vi.mocked(createAgentPlanService).mock.calls[0];
    expect(input.mcp.url).toBe("http://127.0.0.1:3100");
  },
);

it("reaches the instance and the Pica bridge through a configured API address", async () => {
  vi.stubEnv("PAGES_AGENT_API_URL", " https://pages.example.org/ ");
  vi.mocked(getPagesRuntime).mockResolvedValue(
    runtimeFixture("https://pages.example.org"),
  );

  await activateApplicationServices(world.database, DATABASE_PATH);

  const [input] = vi.mocked(createAgentPlanService).mock.calls[0];
  expect(input.mcp.url).toBe("https://pages.example.org/");
  const [chat] = vi.mocked(createChatServices).mock.calls[0];
  expect(chat.acp?.bridgeUrl).toBe(
    "https://pages.example.org/api/v1/pica-bridge",
  );
  expect(chat.protectedOrigin).toBe("https://pages.example.org");
});
