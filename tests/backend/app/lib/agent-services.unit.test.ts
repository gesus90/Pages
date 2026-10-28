import path from "node:path";

import { beforeEach, expect, it, vi } from "vitest";

import { createAgentConfigurationServices } from "@/app/lib/agent-workspace-services.server";
import { createAgentServices } from "@/app/lib/agent-services.server";
import { createRemoteServices } from "@/app/lib/remote-services.server";
import { createRunnerServices } from "@/app/lib/runner-services.server";
import { createAgentToolManager } from "@/backend/service/agents/tools/AgentToolServices";
import { AgentToolStartupService } from "@/backend/service/agents/tools/AgentToolStartupService";
import { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";
import { AcpResourceRepository } from "@/backend/database/repositories/agent/AcpResourceRepository";
import {
  readAcpResourceLimitSource,
  readAcpResourceOptions,
} from "@/backend/config/AcpResourceConfig";
import { CatalogProviderClient } from "@/backend/agents/catalog/CatalogProviderClient";
import { AgentCatalogRefresh } from "@/backend/service/agents/AgentCatalogRefresh";
import { AgentCatalogService } from "@/backend/service/agents/AgentCatalogService";
import { AgentCatalogScheduler } from "@/backend/service/agents/AgentCatalogScheduler";
import { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import { CliLocator } from "@/backend/agents/cli/CliLocator";
import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { createApiProviderRegistry } from "@/backend/agents/providers/ApiProviderRegistry";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { AgentCheckService } from "@/backend/service/agents/AgentCheckService";
import {
  OpenCodeProviderKeys,
  OpenCodeProviderLinks,
} from "@/backend/service/agents/OpenCodeProviderLinks";
import { AgentCliLoginService } from "@/backend/service/agents/AgentCliLoginService";
import { AgentConnectionService } from "@/backend/service/agents/AgentConnectionService";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { ApiTextExecution } from "@/backend/agents/providers/ApiTextExecution";
import { AgentPlanExecution } from "@/backend/agents/AgentPlanExecution";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { AgentConnectionAccess } from "@/backend/service/agents/AgentConnectionAccess";
import { CliSessionExecution } from "@/backend/agents/cli/CliSessionExecution";
import { CliWorkerUnits } from "@/backend/agents/cli/CliWorkerUnit";
import { CHAT_REQUEST_TIMEOUT_MS } from "@/backend/service/chat/ChatExecutionLimits";
import { ChatRequestRegistry } from "@/backend/service/chat/ChatRequestRegistry";
import { AgentAssignmentRepository } from "@/backend/database/repositories/agent/AgentAssignmentRepository";
import { AgentAssignmentService } from "@/backend/service/agents/AgentAssignmentService";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { AgentPlanGitHubCredentials } from "@/backend/service/agents/AgentPlanGitHubCredentials";
import { CliGitHubCredentials } from "@/backend/agents/cli/CliGitHubCredentials";

import type { Database } from "@/backend/database/Database";
import type { AgentTicketAssetDependencies } from "@/backend/service/agents/AgentTicketAssetService";
import type { AgentToolManagerService } from "@/backend/service/agents/tools/AgentToolManagerService";
import type { AgentConfigurationApplicationServices } from "@/app/lib/agent-workspace-services.server";
import type { RemoteApplicationServices } from "@/app/lib/remote-services.server";
import type { RunnerApplicationServices } from "@/app/lib/runner-services.server";
import type { AccountAccess } from "@/definition/Authorization";

const { fakeClasses, opaque, partial } = await vi.hoisted(
  async () => import("./service-wiring-fakes"),
);

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  homedir: vi.fn(() => "/home/pages"),
}));
vi.mock("@/app/lib/agent-workspace-services.server", () => ({
  createAgentConfigurationServices: vi.fn(),
}));
vi.mock("@/app/lib/remote-services.server", () => ({
  createRemoteServices: vi.fn(),
}));
vi.mock("@/app/lib/runner-services.server", () => ({
  createRunnerServices: vi.fn(),
}));
vi.mock("@/backend/service/agents/tools/AgentToolServices", () => ({
  createAgentToolManager: vi.fn(),
}));
vi.mock("@/backend/service/agents/tools/AgentToolStartupService", () =>
  fakeClasses({ AgentToolStartupService: [] }),
);
vi.mock("@/backend/service/agents/AcpResourceScheduler", () =>
  fakeClasses({ AcpResourceScheduler: [] }),
);
vi.mock("@/backend/database/repositories/agent/AcpResourceRepository", () =>
  fakeClasses({ AcpResourceRepository: [] }),
);
vi.mock("@/backend/config/AcpResourceConfig", () => ({
  readAcpResourceLimitSource: vi.fn(),
  readAcpResourceOptions: vi.fn(),
}));
vi.mock("@/backend/agents/catalog/CatalogProviderClient", () =>
  fakeClasses({ CatalogProviderClient: [] }),
);
vi.mock("@/backend/service/agents/AgentCatalogRefresh", () =>
  fakeClasses({ AgentCatalogRefresh: ["run"] }),
);
vi.mock("@/backend/service/agents/AgentCatalogService", () =>
  fakeClasses({ AgentCatalogService: [] }),
);
vi.mock("@/backend/service/agents/AgentCatalogScheduler", () =>
  fakeClasses({ AgentCatalogScheduler: [] }),
);
vi.mock("@/backend/agents/cli/AgentCliRuntime", () =>
  fakeClasses({ AgentCliRuntime: [] }),
);
vi.mock("@/backend/agents/cli/AgentCredentialStore", () =>
  fakeClasses({ AgentCredentialStore: [] }),
);
vi.mock("@/backend/agents/cli/CliLocator", () =>
  fakeClasses({ CliLocator: [] }),
);
vi.mock("@/backend/agents/cli/CliProcessRunner", () =>
  fakeClasses({ CliProcessRunner: [] }),
);
vi.mock("@/backend/agents/providers/ApiProviderRegistry", () => ({
  createApiProviderRegistry: vi.fn(),
}));
vi.mock("@/backend/database/repositories/AgentConnectionRepository", () =>
  fakeClasses({ AgentConnectionRepository: ["catalogs"] }),
);
vi.mock("@/backend/security/InstanceSecretCipher", () =>
  fakeClasses({ InstanceSecretCipher: [] }),
);
vi.mock("@/backend/service/agents/AgentCheckService", () =>
  fakeClasses({ AgentCheckService: ["run"] }),
);
vi.mock("@/backend/service/agents/OpenCodeProviderLinks", () =>
  fakeClasses({ OpenCodeProviderKeys: [], OpenCodeProviderLinks: [] }),
);
vi.mock("@/backend/service/agents/AgentCliLoginService", () =>
  fakeClasses({ AgentCliLoginService: [] }),
);
vi.mock("@/backend/service/agents/AgentConnectionService", () =>
  fakeClasses({ AgentConnectionService: [] }),
);
vi.mock("@/backend/service/agents/AgentOperationRegistry", () =>
  fakeClasses({ AgentOperationRegistry: [] }),
);
vi.mock("@/backend/agents/providers/ApiTextExecution", () =>
  fakeClasses({ ApiTextExecution: [] }),
);
vi.mock("@/backend/agents/AgentPlanExecution", () =>
  fakeClasses({ AgentPlanExecution: [] }),
);
vi.mock("@/backend/database/repositories/AuthorizationRepository", () =>
  fakeClasses({ AuthorizationRepository: [] }),
);
vi.mock("@/backend/database/repositories/UserGroupRepository", () =>
  fakeClasses({ UserGroupRepository: [] }),
);
vi.mock("@/backend/service/agents/AgentConnectionAccess", () =>
  fakeClasses({ AgentConnectionAccess: [] }),
);
vi.mock("@/backend/agents/cli/CliSessionExecution", () =>
  fakeClasses({ CliSessionExecution: [] }),
);
vi.mock("@/backend/agents/cli/CliWorkerUnit", () =>
  fakeClasses({ CliWorkerUnits: [] }),
);
vi.mock("@/backend/service/chat/ChatRequestRegistry", () =>
  fakeClasses({ ChatRequestRegistry: [] }),
);
vi.mock("@/backend/database/repositories/agent/AgentAssignmentRepository", () =>
  fakeClasses({ AgentAssignmentRepository: [] }),
);
vi.mock("@/backend/service/agents/AgentAssignmentService", () =>
  fakeClasses({ AgentAssignmentService: [] }),
);
vi.mock("@/backend/database/repositories/ProjectRepository", () =>
  fakeClasses({ ProjectRepository: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanGitHubCredentials", () =>
  fakeClasses({ AgentPlanGitHubCredentials: [] }),
);
vi.mock("@/backend/agents/cli/CliGitHubCredentials", () =>
  fakeClasses({ CliGitHubCredentials: [] }),
);

const DATABASE = opaque<Database>("database");
const TOKEN_KEY = Buffer.from("token-key");
const TICKET_ASSETS = opaque<AgentTicketAssetDependencies>("ticket assets");
const ACP_OPTIONS = { maxConcurrentAcpSessions: 3 };
const CONFIGURATION = partial<AgentConfigurationApplicationServices>({
  agentWorkspaceService: opaque("workspaces"),
  agentProfileService: opaque("profiles"),
});
const REMOTE = partial<RemoteApplicationServices>({
  remoteConnectionService: opaque("remote connections"),
});
const RUNNER = partial<RunnerApplicationServices>({
  runnerService: opaque("runners"),
});
const TOOL_MANAGER = partial<AgentToolManagerService>({
  directory: "/srv/pages/tools",
  locate: vi.fn(),
});

function create(): ReturnType<typeof createAgentServices> {
  return createAgentServices(DATABASE, "/srv/pages/data", TOKEN_KEY, {
    acpOptions: ACP_OPTIONS,
    agentsDirectory: "/srv/pages/Agents",
    ticketAssets: TICKET_ASSETS,
  });
}

/** The single instance a fake class created. */
function only<Instance>(fake: {
  readonly mock: { readonly instances: Instance[] };
}): Instance {
  expect(fake.mock.instances).toHaveLength(1);
  return fake.mock.instances[0];
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createAgentConfigurationServices).mockReturnValue(CONFIGURATION);
  vi.mocked(createRemoteServices).mockReturnValue(REMOTE);
  vi.mocked(createRunnerServices).mockReturnValue(RUNNER);
  vi.mocked(createAgentToolManager).mockReturnValue(TOOL_MANAGER);
  vi.mocked(readAcpResourceOptions).mockReturnValue(opaque("acp options"));
  vi.mocked(readAcpResourceLimitSource).mockReturnValue(opaque("acp source"));
  vi.mocked(createApiProviderRegistry).mockReturnValue(opaque("providers"));
  vi.mocked(AgentConnectionRepository.prototype.catalogs).mockReturnValue(
    opaque("catalogs"),
  );
});

it("opens the shared connection, cipher, operations and resource limits once", () => {
  const services = create();

  expect(vi.mocked(AgentConnectionRepository).mock.calls).toEqual([[DATABASE]]);
  expect(vi.mocked(InstanceSecretCipher).mock.calls).toEqual([[TOKEN_KEY]]);
  only(vi.mocked(AgentOperationRegistry));
  expect(readAcpResourceOptions).toHaveBeenCalledWith(ACP_OPTIONS);
  expect(readAcpResourceLimitSource).toHaveBeenCalledWith(ACP_OPTIONS);
  expect(vi.mocked(AcpResourceScheduler).mock.calls[0][0]).toEqual({
    store: only(vi.mocked(AcpResourceRepository)),
    options: opaque("acp options"),
    limitSource: opaque("acp source"),
  });
  expect(vi.mocked(AcpResourceRepository).mock.calls).toEqual([[DATABASE]]);
  expect(services.acpResourceScheduler).toBe(
    only(vi.mocked(AcpResourceScheduler)),
  );
});

it("merges configuration, credentials, remote and runner services", () => {
  const services = create();

  const repository = only(vi.mocked(AgentConnectionRepository));
  expect(createAgentConfigurationServices).toHaveBeenCalledWith({
    database: DATABASE,
    dataDirectory: "/srv/pages/data",
    agentsDirectory: "/srv/pages/Agents",
    connections: repository,
    operations: only(vi.mocked(AgentOperationRegistry)),
    ticketAssets: TICKET_ASSETS,
  });
  const cipher = only(vi.mocked(InstanceSecretCipher));
  expect(createRemoteServices).toHaveBeenCalledWith({
    database: DATABASE,
    cipher,
  });
  expect(createRunnerServices).toHaveBeenCalledWith({
    database: DATABASE,
    remote: REMOTE,
    tokenKey: TOKEN_KEY,
    configuration: CONFIGURATION,
  });
  expect(services).toMatchObject({
    ...CONFIGURATION,
    ...REMOTE,
    ...RUNNER,
  });
  expect(vi.mocked(AgentPlanGitHubCredentials).mock.calls[0][0]).toEqual({
    projects: only(vi.mocked(ProjectRepository)),
    workspaces: CONFIGURATION.agentWorkspaceService,
    tokenKey: TOKEN_KEY,
  });
  expect(vi.mocked(CliGitHubCredentials).mock.calls).toEqual([
    ["/srv/pages/data"],
  ]);
  expect(services.agentPlanGitHubCredentials).toBe(
    only(vi.mocked(AgentPlanGitHubCredentials)),
  );
  expect(services.agentCliGitHubCredentials).toBe(
    only(vi.mocked(CliGitHubCredentials)),
  );
});

it("builds the CLI runtime on a managed tool locator", async () => {
  const services = create();

  const runner = only(vi.mocked(CliProcessRunner));
  const [plainLocator, managedLocator] = vi.mocked(CliLocator).mock.instances;
  expect(createAgentToolManager).toHaveBeenCalledWith({
    instanceDirectory: "/srv/pages",
    locator: plainLocator,
    runner,
  });
  expect(vi.mocked(CliLocator).mock.calls[0]).toEqual([]);
  const [searchPath, nodePath, managed] = vi.mocked(CliLocator).mock.calls[1];
  expect([searchPath, nodePath]).toEqual([undefined, undefined]);
  vi.mocked(TOOL_MANAGER.locate).mockResolvedValue(null);
  await expect(managed?.("codex")).resolves.toBe(null);
  expect(TOOL_MANAGER.locate).toHaveBeenCalledWith("codex");
  const store = only(vi.mocked(AgentCredentialStore));
  expect(vi.mocked(AgentCredentialStore).mock.calls).toEqual([
    ["/srv/pages/data"],
  ]);
  expect(vi.mocked(AgentCliRuntime).mock.calls[0][0]).toEqual({
    store,
    locator: managedLocator,
    runner,
    cipher: only(vi.mocked(InstanceSecretCipher)),
    tools: TOOL_MANAGER,
    linkedKeys: only(vi.mocked(OpenCodeProviderKeys)),
  });
  expect(vi.mocked(OpenCodeProviderKeys).mock.calls[0]).toEqual([
    only(vi.mocked(AgentConnectionRepository)),
    only(vi.mocked(InstanceSecretCipher)),
  ]);
  expect(services.agentToolManagerService).toBe(TOOL_MANAGER);
});

it("shares one catalog refresh between login, catalog reads and the scheduler", () => {
  const services = create();

  const repository = only(vi.mocked(AgentConnectionRepository));
  const cipher = only(vi.mocked(InstanceSecretCipher));
  const operations = only(vi.mocked(AgentOperationRegistry));
  const runtime = only(vi.mocked(AgentCliRuntime));
  const refresh = only(vi.mocked(AgentCatalogRefresh));
  expect(vi.mocked(AgentCatalogRefresh).mock.calls[0][0]).toEqual({
    repository,
    cipher,
    operations,
    client: only(vi.mocked(CatalogProviderClient)),
    cli: runtime,
  });
  expect(vi.mocked(AgentCliLoginService).mock.calls[0][0]).toEqual({
    repository,
    store: only(vi.mocked(AgentCredentialStore)),
    locator: vi.mocked(CliLocator).mock.instances[1],
    runner: only(vi.mocked(CliProcessRunner)),
    runtime,
    operations,
    catalog: refresh,
  });
  expect(vi.mocked(AgentCatalogService).mock.calls[0]).toEqual([
    repository,
    refresh,
    operations,
  ]);
  expect(vi.mocked(AgentCatalogScheduler).mock.calls[0]).toEqual([
    opaque("catalogs"),
    refresh,
  ]);
  expect(vi.mocked(AgentConnectionService).mock.calls[0][0]).toEqual({
    repository,
    cipher,
    operations,
    cli: services.agentCliLoginService,
  });
  expect(services).toMatchObject({
    agentCliLoginService: only(vi.mocked(AgentCliLoginService)),
    agentCatalogService: only(vi.mocked(AgentCatalogService)),
    agentCatalogScheduler: only(vi.mocked(AgentCatalogScheduler)),
    agentConnectionService: only(vi.mocked(AgentConnectionService)),
  });
});

it("wires access, assignments, tool startup and the chat request registry", () => {
  const services = create();

  const repository = only(vi.mocked(AgentConnectionRepository));
  expect(vi.mocked(AgentConnectionAccess).mock.calls[0][0]).toEqual({
    connections: repository,
    authorization: only(vi.mocked(AuthorizationRepository)),
    groups: only(vi.mocked(UserGroupRepository)),
  });
  expect(services.agentConnectionAccess).toBe(
    only(vi.mocked(AgentConnectionAccess)),
  );
  expect(vi.mocked(AgentAssignmentService).mock.calls[0][0]).toEqual({
    assignments: only(vi.mocked(AgentAssignmentRepository)),
    connections: repository,
  });
  expect(services.agentAssignmentService).toBe(
    only(vi.mocked(AgentAssignmentService)),
  );
  expect(vi.mocked(AgentToolStartupService).mock.calls[0][0]).toEqual({
    manager: TOOL_MANAGER,
    connections: repository,
    runtime: only(vi.mocked(AgentCliRuntime)),
    resources: services.acpResourceScheduler,
  });
  expect(services.agentToolStartupService).toBe(
    only(vi.mocked(AgentToolStartupService)),
  );
  expect(vi.mocked(ChatRequestRegistry).mock.calls).toEqual([
    [{ timeoutMs: CHAT_REQUEST_TIMEOUT_MS, capacity: 16 }],
  ]);
  expect(services.chatRequests).toBe(only(vi.mocked(ChatRequestRegistry)));
});

it("checks connections with the shared registry and links OpenCode providers", async () => {
  const services = create();

  const repository = only(vi.mocked(AgentConnectionRepository));
  expect(vi.mocked(AgentCheckService).mock.calls[0][0]).toEqual({
    repository,
    catalog: only(vi.mocked(AgentCatalogRefresh)),
    cipher: only(vi.mocked(InstanceSecretCipher)),
    operations: only(vi.mocked(AgentOperationRegistry)),
    cli: only(vi.mocked(AgentCliRuntime)),
    providers: opaque("providers"),
  });
  expect(services.agentCheckService).toBe(only(vi.mocked(AgentCheckService)));
  expect(services.openCodeProviderLinks).toBe(
    only(vi.mocked(OpenCodeProviderLinks)),
  );
  const [links] = vi.mocked(OpenCodeProviderLinks).mock.calls[0];
  expect(links.connections).toBe(repository);
  const actor = opaque<AccountAccess>("actor");
  vi.mocked(AgentCheckService.prototype.run).mockResolvedValue(
    opaque("checked"),
  );
  vi.mocked(AgentCatalogRefresh.prototype.run).mockResolvedValue(
    opaque("refreshed"),
  );
  await expect(links.check(actor, "connection-1")).resolves.toEqual(
    opaque("checked"),
  );
  expect(AgentCheckService.prototype.run).toHaveBeenCalledWith(
    actor,
    "connection-1",
    "auth",
  );
  await expect(links.refreshCatalog("connection-2")).resolves.toEqual(
    opaque("refreshed"),
  );
  expect(AgentCatalogRefresh.prototype.run).toHaveBeenCalledWith(
    "connection-2",
  );
});

it("runs plan steps over the API and over isolated CLI sessions", () => {
  vi.stubEnv("PAGES_CLI_ISOLATION", undefined);
  const services = create();

  const cipher = only(vi.mocked(InstanceSecretCipher));
  expect(vi.mocked(ApiTextExecution).mock.calls[0]).toEqual([
    only(vi.mocked(AgentConnectionRepository)),
    cipher,
  ]);
  expect(vi.mocked(AgentPlanExecution).mock.calls[0]).toEqual([
    only(vi.mocked(ApiTextExecution)),
    only(vi.mocked(CliSessionExecution)),
    only(vi.mocked(AgentOperationRegistry)),
    only(vi.mocked(AgentConnectionAccess)),
  ]);
  expect(services.agentPlanExecution).toBe(only(vi.mocked(AgentPlanExecution)));
  expect(vi.mocked(CliWorkerUnits).mock.calls).toEqual([
    ["/srv/pages/data/worker-units"],
  ]);
  const nodeDirectory = path.dirname(process.execPath);
  expect(vi.mocked(CliSessionExecution).mock.calls[0][0]).toEqual({
    runtime: only(vi.mocked(AgentCliRuntime)),
    store: only(vi.mocked(AgentCredentialStore)),
    locator: vi.mocked(CliLocator).mock.instances[1],
    runner: only(vi.mocked(CliProcessRunner)),
    tools: TOOL_MANAGER,
    resources: services.acpResourceScheduler,
    github: services.agentCliGitHubCredentials,
    units: only(vi.mocked(CliWorkerUnits)),
    isolation: {
      protectedDirectories: ["/srv/pages/data", "/srv/pages/Agents"],
      isRequired: false,
      readOnlyDirectories: [
        "/srv/pages/tools",
        nodeDirectory,
        path.join(path.dirname(nodeDirectory), "lib", "node_modules"),
      ],
      hiddenDirectories: ["/home/pages"],
    },
  });
});

it("requires CLI isolation only when the operator says so", () => {
  vi.stubEnv("PAGES_CLI_ISOLATION", "required");

  create();

  const [options] = vi.mocked(CliSessionExecution).mock.calls[0];
  expect(options.isolation?.isRequired).toBe(true);
});
