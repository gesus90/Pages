import { beforeEach, expect, it, vi } from "vitest";

import { startExecutionServices } from "@/app/lib/agent-execution-services.server";
import { createAgentServices } from "@/app/lib/agent-services.server";
import { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import { interruptedAcpOwners } from "@/backend/service/agents/AgentPlanRecovery";
import { AgentAssetRepository } from "@/backend/database/repositories/agents/AgentAssetRepository";
import { AgentAssetService } from "@/backend/service/agents/AgentAssetService";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";
import { resolveAgentsDirectory } from "@/backend/config/PagesConfig";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";

import type { Mock } from "vitest";
import type { AgentApplicationServices } from "@/app/lib/agent-services.server";
import type { Database } from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AcpResourceOwner } from "@/definition/AcpResource";
import type { PagesRuntime } from "@/backend/runtime/PagesRuntime";
import type { TaskAttachmentService } from "@/backend/service/task/TaskAttachmentService";
import type { WikiService } from "@/backend/service/WikiService";

const { fakeClasses, opaque, partial } = await vi.hoisted(
  async () => import("./service-wiring-fakes"),
);

vi.mock("@/app/lib/agent-services.server", () => ({
  createAgentServices: vi.fn(),
}));
vi.mock("@/backend/database/repositories/agent/AgentPlanRunRepository", () =>
  fakeClasses({ AgentPlanRunRepository: ["unfinished", "reserving"] }),
);
vi.mock("@/backend/service/agents/AgentPlanRecovery", () => ({
  interruptedAcpOwners: vi.fn(),
}));
vi.mock("@/backend/database/repositories/agents/AgentAssetRepository", () =>
  fakeClasses({ AgentAssetRepository: [] }),
);
vi.mock("@/backend/service/agents/AgentAssetService", () =>
  fakeClasses({ AgentAssetService: [] }),
);
vi.mock("@/backend/storage/WikiFileStore", () =>
  fakeClasses({ WikiFileStore: [] }),
);
vi.mock("@/backend/config/PagesConfig", () => ({
  resolveAgentsDirectory: vi.fn(),
}));
vi.mock("@/backend/runtime/PagesRuntime", () => ({
  getPagesRuntime: vi.fn(),
}));

const DATABASE = opaque<Database>("database");
const TOKEN_KEY = Buffer.from("token-key");
const TICKETS = opaque<TaskAttachmentService>("tickets");
const WIKI = opaque<WikiService>("wiki");
const CONFIG = { port: 3100 };
const OWNERS = [opaque<AcpResourceOwner>("owner")];

interface AgentFixture {
  readonly services: AgentApplicationServices;
  readonly recoverCredentials: Mock;
  readonly recoverResources: Mock;
  readonly startTools: Mock;
  readonly startCatalog: Mock;
}

/** Agent services whose startup steps record their calls in order. */
function agentFixture(): AgentFixture {
  const recoverCredentials = vi.fn(async () => [
    { instanceId: "instance-1" },
    { instanceId: "instance-2" },
  ]);
  const recoverResources = vi.fn(async () => undefined);
  const startTools = vi.fn(async () => undefined);
  const startCatalog = vi.fn();
  const services = partial<AgentApplicationServices>({
    agentCliGitHubCredentials: { recover: recoverCredentials },
    acpResourceScheduler: { recover: recoverResources },
    agentToolStartupService: { start: startTools },
    agentCatalogScheduler: { start: startCatalog },
  });
  return {
    services,
    recoverCredentials,
    recoverResources,
    startTools,
    startCatalog,
  };
}

async function start(): Promise<AgentApplicationServices> {
  const { agentServices } = await startExecutionServices(
    DATABASE,
    "/srv/pages/data/pages.db",
    { tokenKey: TOKEN_KEY, tickets: TICKETS, wiki: WIKI },
  );
  return agentServices;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPagesRuntime).mockResolvedValue(
    partial<PagesRuntime>({
      configFile: { path: "/srv/pages/config.json" },
      getConfig: () => CONFIG,
    }),
  );
  vi.mocked(resolveAgentsDirectory).mockReturnValue("/srv/pages/Agents");
  vi.mocked(interruptedAcpOwners).mockReturnValue(OWNERS);
  vi.mocked(AgentPlanRunRepository.prototype.unfinished).mockResolvedValue([
    partial<AgentPlanRun>({ id: "run-1" }),
  ]);
  vi.mocked(AgentPlanRunRepository.prototype.reserving).mockResolvedValue([
    partial<AgentPlanRun>({ id: "run-2" }),
  ]);
});

it("creates the agent services next to the database with the configured agent folder", async () => {
  const fixture = agentFixture();
  vi.mocked(createAgentServices).mockReturnValue(fixture.services);

  await expect(start()).resolves.toBe(fixture.services);

  expect(resolveAgentsDirectory).toHaveBeenCalledWith("/srv/pages/config.json");
  const [database, directory, tokenKey, resources] =
    vi.mocked(createAgentServices).mock.calls[0];
  expect([database, directory, tokenKey]).toEqual([
    DATABASE,
    "/srv/pages/data",
    TOKEN_KEY,
  ]);
  expect(resources.agentsDirectory).toBe("/srv/pages/Agents");
  expect(resources.acpOptions).toBe(CONFIG);
});

it("reads ticket assets from tickets, the wiki and the agent asset folder", async () => {
  vi.mocked(createAgentServices).mockReturnValue(agentFixture().services);

  await start();

  const [, , , resources] = vi.mocked(createAgentServices).mock.calls[0];
  const [assets] = vi.mocked(AgentAssetService).mock.instances;
  expect(resources.ticketAssets).toEqual({
    tickets: TICKETS,
    wiki: WIKI,
    assets,
  });
  expect(resources.ticketAssets.assets).toBe(assets);
  expect(vi.mocked(AgentAssetService).mock.calls[0][0]).toEqual({
    repository: vi.mocked(AgentAssetRepository).mock.instances[0],
    files: vi.mocked(WikiFileStore).mock.instances[0],
    wiki: WIKI,
  });
  expect(vi.mocked(AgentAssetRepository).mock.calls).toEqual([[DATABASE]]);
  expect(vi.mocked(WikiFileStore).mock.calls).toEqual([
    ["/srv/pages/data/agent-assets"],
  ]);
});

it("recovers resources of interrupted runs and keeps unconfirmed credential leftovers", async () => {
  const fixture = agentFixture();
  vi.mocked(createAgentServices).mockReturnValue(fixture.services);

  await start();

  expect(vi.mocked(AgentPlanRunRepository).mock.calls).toEqual([[DATABASE]]);
  expect(interruptedAcpOwners).toHaveBeenCalledWith([
    partial<AgentPlanRun>({ id: "run-1" }),
    partial<AgentPlanRun>({ id: "run-2" }),
  ]);
  expect(fixture.recoverResources).toHaveBeenCalledWith(
    OWNERS,
    new Set(["instance-1", "instance-2"]),
  );
  expect(fixture.recoverCredentials.mock.invocationCallOrder[0]).toBeLessThan(
    fixture.recoverResources.mock.invocationCallOrder[0],
  );
  expect(fixture.startTools).toHaveBeenCalledOnce();
  expect(fixture.startCatalog).toHaveBeenCalledOnce();
  expect(fixture.recoverResources.mock.invocationCallOrder[0]).toBeLessThan(
    fixture.startCatalog.mock.invocationCallOrder[0],
  );
});

it("keeps Pages available when the tool startup checks fail", async () => {
  const fixture = agentFixture();
  fixture.startTools.mockRejectedValue(new Error("tool check failed"));
  vi.mocked(createAgentServices).mockReturnValue(fixture.services);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  await expect(start()).resolves.toBe(fixture.services);
  await vi.waitFor(() => {
    expect(warn).toHaveBeenCalledWith(
      "[pages] Agent tool startup checks could not finish; other Pages functions remain available.",
    );
  });
  expect(fixture.startCatalog).toHaveBeenCalledOnce();
});
