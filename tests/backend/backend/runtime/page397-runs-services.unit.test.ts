import { beforeEach, expect, it, vi } from "vitest";

import { createRunsServices } from "@/backend/runtime/RunsServices";
import { Database } from "@/backend/database/Database";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { createPlanFoundation } from "@/app/lib/plan-foundation.server";
import { createPlanAgentServices } from "@/app/lib/plan-agent-services.server";
import { createPlanProcessingServices } from "@/app/lib/agent-plan-services.server";
import { claimRunsProcessing } from "@/backend/service/agents/runs/RunsProcessing";
import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";

import type { PagesRuntime } from "@/backend/runtime/PagesRuntime";
import type { PlanFoundation } from "@/app/lib/plan-foundation.server";
import type { PlanAgentRuntimeServices } from "@/app/lib/plan-agent-services.server";
import type { PlanProcessingServices } from "@/app/lib/agent-plan-services.server";

const { partial } = await vi.hoisted(
  async () => import("../../app/lib/service-wiring-fakes"),
);
const mocks = vi.hoisted(() => ({
  discover: vi.fn(async () => ({
    adopted: new Set<string>(),
    uncertain: new Set<string>(),
  })),
  credentials: vi.fn(async () => []),
  recover: vi.fn(),
  settle: vi.fn(),
  detach: vi.fn(),
  plans: vi.fn(),
  resources: vi.fn(),
  tools: vi.fn(),
  clients: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/backend/database/Database", () => ({
  Database: { connect: vi.fn() },
}));
vi.mock("@/backend/runtime/PagesRuntime", () => ({ getPagesRuntime: vi.fn() }));
vi.mock("@/backend/runtime/ProcessLifecycle", () => ({
  registerShutdownTask: vi.fn(),
}));
vi.mock("@/backend/service/agents/runs/RunsProcessing", () => ({
  claimRunsProcessing: vi.fn(),
}));
vi.mock("@/backend/github/GitHubTokenKey", () => ({
  resolveGitHubTokenKey: () => Buffer.alloc(32),
}));
vi.mock("@/app/lib/plan-foundation.server", () => ({
  createPlanFoundation: vi.fn(),
}));
vi.mock("@/app/lib/plan-agent-services.server", () => ({
  createPlanAgentServices: vi.fn(),
}));
vi.mock("@/app/lib/agent-plan-services.server", () => ({
  createPlanProcessingServices: vi.fn(),
}));
vi.mock("@/app/lib/plan-run-recorders.server", () => ({
  startPlanRunRecorders: vi.fn(),
}));
vi.mock("@/backend/database/repositories/agent/AgentPlanRunRepository", () => ({
  AgentPlanRunRepository: class {
    public async unfinished(): Promise<never[]> {
      return [];
    }
    public async reserving(): Promise<never[]> {
      return [];
    }
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPagesRuntime).mockResolvedValue(
    partial<PagesRuntime>({
      configFile: { path: "/synthetic/config.toml" },
      getDatabasePath: () => "/synthetic/data/pages",
      getDatabaseUrl: () => "postgres://localhost/disposable",
      getConfig: () => ({
        firstRun: false,
        port: 3101,
        databasePath: "/synthetic/data/pages",
        runsMode: "separate",
      }),
    }),
  );
  vi.mocked(Database.connect).mockResolvedValue(
    partial<Database>({ close: mocks.close }),
  );
  vi.mocked(createPlanFoundation).mockReturnValue(partial<PlanFoundation>({}));
  vi.mocked(createPlanAgentServices).mockReturnValue(
    partial<PlanAgentRuntimeServices>({
      localSessions: {
        discover: mocks.discover,
        settleFinished: mocks.settle,
        detachAll: mocks.detach,
      },
      agentCliGitHubCredentials: { recover: mocks.credentials },
      acpResourceScheduler: {
        recover: mocks.recover,
        shutdown: mocks.resources,
      },
      agentToolManagerService: { shutdown: mocks.tools },
      closeClients: mocks.clients,
    }),
  );
  vi.mocked(createPlanProcessingServices).mockResolvedValue(
    partial<PlanProcessingServices>({
      agentPlanService: { shutdown: mocks.plans },
    }),
  );
});

it("claims ownership before discovering surviving owners and exposes database health", async () => {
  const services = await createRunsServices();
  expect(services.healthService).toBeDefined();
  expect(
    vi.mocked(claimRunsProcessing).mock.invocationCallOrder[0],
  ).toBeLessThan(mocks.discover.mock.invocationCallOrder[0]);
  expect(mocks.discover.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.credentials.mock.invocationCallOrder[0],
  );
  expect(mocks.credentials.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.recover.mock.invocationCallOrder[0],
  );
  expect(mocks.settle.mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(createPlanProcessingServices).mock.invocationCallOrder[0],
  );
  await expect(
    vi.mocked(createPlanProcessingServices).mock.calls[0][0].api(),
  ).rejects.toThrow("API process");
});

it("detaches surviving native work and closes plan resources before its database", async () => {
  await createRunsServices();
  const shutdown = vi
    .mocked(registerShutdownTask)
    .mock.calls.find(([, options]) => options.step === "runs_services")?.[0];
  expect(shutdown).toBeDefined();
  await shutdown?.();
  expect(mocks.detach).toHaveBeenCalledOnce();
  expect(mocks.plans.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.resources.mock.invocationCallOrder[0],
  );
  expect(mocks.resources.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.tools.mock.invocationCallOrder[0],
  );
  expect(mocks.tools.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.clients.mock.invocationCallOrder[0],
  );
  expect(mocks.clients.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.close.mock.invocationCallOrder[0],
  );
});
