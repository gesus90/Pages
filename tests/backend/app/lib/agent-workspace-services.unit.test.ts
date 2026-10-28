import { homedir } from "node:os";
import path from "node:path";

import { beforeEach, expect, it, vi } from "vitest";

import {
  createAgentConfigurationServices,
  resolveWorkspaceRoots,
} from "@/app/lib/agent-workspace-services.server";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { AgentProfileRepository } from "@/backend/database/repositories/agent/AgentProfileRepository";
import { AgentWorkspaceRepository } from "@/backend/database/repositories/agent/AgentWorkspaceRepository";
import { AgentContentAccess } from "@/backend/service/agents/AgentContentAccess";
import { AgentParameterService } from "@/backend/service/agents/AgentParameterService";
import { AgentProfileService } from "@/backend/service/agents/AgentProfileService";
import { AgentWorkspacePath } from "@/backend/service/agents/AgentWorkspacePath";
import { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import { AgentDefinitionFiles } from "@/backend/service/agents/AgentDefinitionFiles";
import { AgentRunArchive } from "@/backend/service/agents/AgentRunArchive";
import { PageAgentService } from "@/backend/service/agents/PageAgentService";
import { PageAgentRunRepository } from "@/backend/database/repositories/agent/PageAgentRunRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { AgentTicketParameterService } from "@/backend/service/agents/AgentTicketParameterService";
import { createAgentTaskContext } from "@/backend/service/agents/AgentTaskAccess";
import { AgentTicketAssetService } from "@/backend/service/agents/AgentTicketAssetService";
import { PicaSettingsRepository } from "@/backend/database/repositories/chat/PicaSettingsRepository";
import { PicaSettingsService } from "@/backend/service/chat/PicaSettingsService";

import type { Database } from "@/backend/database/Database";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import type { AgentTicketAssetDependencies } from "@/backend/service/agents/AgentTicketAssetService";
import type { User } from "@/definition/User";
import type { AuthorizationSnapshot } from "@/backend/database/repositories/AuthorizationRepository";

const { fakeClasses, opaque, partial } = await vi.hoisted(
  async () => import("./service-wiring-fakes"),
);

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  homedir: vi.fn(() => "/home/pages"),
}));
vi.mock("@/backend/database/repositories/AuthorizationRepository", () =>
  fakeClasses({ AuthorizationRepository: ["snapshot"] }),
);
vi.mock("@/backend/database/repositories/ProjectRepository", () =>
  fakeClasses({ ProjectRepository: [] }),
);
vi.mock("@/backend/database/repositories/UserGroupRepository", () =>
  fakeClasses({ UserGroupRepository: [] }),
);
vi.mock("@/backend/database/repositories/WikiRepository", () =>
  fakeClasses({ WikiRepository: [] }),
);
vi.mock("@/backend/database/repositories/agent/AgentProfileRepository", () =>
  fakeClasses({ AgentProfileRepository: ["list"] }),
);
vi.mock("@/backend/database/repositories/agent/AgentWorkspaceRepository", () =>
  fakeClasses({ AgentWorkspaceRepository: [] }),
);
vi.mock("@/backend/service/agents/AgentContentAccess", () =>
  fakeClasses({ AgentContentAccess: ["wiki"] }),
);
vi.mock("@/backend/service/agents/AgentParameterService", () =>
  fakeClasses({ AgentParameterService: [] }),
);
vi.mock("@/backend/service/agents/AgentProfileService", () =>
  fakeClasses({ AgentProfileService: [] }),
);
vi.mock("@/backend/service/agents/AgentWorkspacePath", () =>
  fakeClasses({ AgentWorkspacePath: [] }),
);
vi.mock("@/backend/service/agents/AgentWorkspaceService", () =>
  fakeClasses({ AgentWorkspaceService: [] }),
);
vi.mock("@/backend/service/agents/AgentDefinitionFiles", () =>
  fakeClasses({ AgentDefinitionFiles: [] }),
);
vi.mock("@/backend/service/agents/AgentRunArchive", () =>
  fakeClasses({ AgentRunArchive: [] }),
);
vi.mock("@/backend/service/agents/PageAgentService", () =>
  fakeClasses({ PageAgentService: [] }),
);
vi.mock("@/backend/database/repositories/agent/PageAgentRunRepository", () =>
  fakeClasses({ PageAgentRunRepository: [] }),
);
vi.mock("@/backend/database/repositories/UserRepository", () =>
  fakeClasses({ UserRepository: ["findById"] }),
);
vi.mock("@/backend/service/agents/AgentTicketParameterService", () =>
  fakeClasses({ AgentTicketParameterService: [] }),
);
vi.mock("@/backend/service/agents/AgentTaskAccess", () => ({
  createAgentTaskContext: vi.fn(),
}));
vi.mock("@/backend/service/agents/AgentTicketAssetService", () =>
  fakeClasses({ AgentTicketAssetService: [] }),
);
vi.mock("@/backend/database/repositories/chat/PicaSettingsRepository", () =>
  fakeClasses({ PicaSettingsRepository: [] }),
);
vi.mock("@/backend/service/chat/PicaSettingsService", () =>
  fakeClasses({ PicaSettingsService: [] }),
);

const DATABASE = opaque<Database>("database");
const CONNECTIONS = opaque<AgentConnectionRepository>("connections");
const OPERATIONS = opaque<AgentOperationRegistry>("operations");
const TICKET_ASSETS = opaque<AgentTicketAssetDependencies>("ticket assets");

function create(): ReturnType<typeof createAgentConfigurationServices> {
  return createAgentConfigurationServices({
    database: DATABASE,
    dataDirectory: "/srv/pages/data",
    agentsDirectory: "/srv/pages/Agents",
    connections: CONNECTIONS,
    operations: OPERATIONS,
    ticketAssets: TICKET_ASSETS,
  });
}

/** The ticket-context and wiki-reference callbacks the ticket parameters were built with. */
function ticketCallbacks(): {
  readonly context: ConstructorParameters<
    typeof AgentTicketParameterService
  >[0];
  readonly wiki: NonNullable<
    ConstructorParameters<typeof AgentTicketParameterService>[2]
  >;
} {
  const [context, , wiki] = vi.mocked(AgentTicketParameterService).mock
    .calls[0];
  if (!wiki) throw new Error("The ticket parameters read no wiki references.");
  return { context, wiki };
}

beforeEach(() => {
  vi.resetAllMocks();
});

it("narrows workspaces to the configured roots without an opening level", () => {
  vi.stubEnv(
    "PAGES_WORKSPACE_ROOTS",
    [" /srv/projects ", "", "/opt/work"].join(path.delimiter),
  );

  expect(resolveWorkspaceRoots()).toEqual({
    roots: ["/srv/projects", "/opt/work"],
  });
});

it("opens at the home directory and allows its whole file system without a variable", () => {
  vi.stubEnv("PAGES_WORKSPACE_ROOTS", undefined);

  expect(resolveWorkspaceRoots()).toEqual({
    roots: ["/"],
    startDirectory: "/home/pages",
  });
});

it("falls back to the path separator when the home directory has no root", () => {
  vi.stubEnv("PAGES_WORKSPACE_ROOTS", undefined);
  vi.mocked(homedir).mockReturnValue("pages-home");

  expect(resolveWorkspaceRoots()).toEqual({
    roots: [path.sep],
    startDirectory: "pages-home",
  });
});

it("keeps the instance folders out of every workspace", () => {
  vi.stubEnv("PAGES_WORKSPACE_ROOTS", "/srv/projects");
  const services = create();

  expect(vi.mocked(AgentWorkspacePath).mock.calls).toEqual([
    [
      {
        roots: ["/srv/projects"],
        protectedDirectory: "/srv/pages/data",
        additionalProtectedDirectories: [
          "/srv/pages/Agents",
          "/srv/pages/tools",
        ],
      },
    ],
  ]);
  expect(vi.mocked(AgentWorkspaceService).mock.calls[0][0]).toEqual({
    workspaces: vi.mocked(AgentWorkspaceRepository).mock.instances[0],
    authorization: vi.mocked(AuthorizationRepository).mock.instances[0],
    projects: vi.mocked(ProjectRepository).mock.instances[0],
    paths: vi.mocked(AgentWorkspacePath).mock.instances[0],
  });
  expect(services.agentWorkspaceService).toBe(
    vi.mocked(AgentWorkspaceService).mock.instances[0],
  );
});

it("shares one set of dependencies between Pica settings, profiles and page agents", () => {
  const services = create();

  const dependencies = {
    profiles: vi.mocked(AgentProfileRepository).mock.instances[0],
    connections: CONNECTIONS,
    authorization: vi.mocked(AuthorizationRepository).mock.instances[0],
    groups: vi.mocked(UserGroupRepository).mock.instances[0],
    operations: OPERATIONS,
    content: services.agentContentAccess,
    tickets: services.agentTicketParameterService,
    workspaces: services.agentWorkspaceService,
    files: services.agentDefinitionFiles,
  };
  expect(vi.mocked(PicaSettingsService).mock.calls[0][0]).toEqual({
    ...dependencies,
    settings: vi.mocked(PicaSettingsRepository).mock.instances[0],
  });
  expect(vi.mocked(AgentProfileService).mock.calls[0][0]).toEqual({
    ...dependencies,
    pica: services.picaSettingsService,
  });
  expect(vi.mocked(PageAgentService).mock.calls[0]).toEqual([
    dependencies,
    services.agentProfileService,
    services.agentDefinitionFiles,
  ]);
  expect(services.picaSettingsService).toBe(
    vi.mocked(PicaSettingsService).mock.instances[0],
  );
  expect(services.agentProfileService).toBe(
    vi.mocked(AgentProfileService).mock.instances[0],
  );
  expect(services.pageAgentService).toBe(
    vi.mocked(PageAgentService).mock.instances[0],
  );
});

it("prepares parameters, content, assets and run records on the shared services", () => {
  const services = create();

  expect(vi.mocked(AgentContentAccess).mock.calls[0]).toEqual([
    vi.mocked(ProjectRepository).mock.instances[0],
    vi.mocked(WikiRepository).mock.instances[0],
  ]);
  expect(vi.mocked(AgentTicketAssetService).mock.calls).toEqual([
    [TICKET_ASSETS],
  ]);
  expect(services.agentTicketAssetService).toBe(
    vi.mocked(AgentTicketAssetService).mock.instances[0],
  );
  expect(vi.mocked(AgentTicketParameterService).mock.calls[0][1]).toBe(
    services.agentTicketAssetService,
  );
  expect(vi.mocked(AgentParameterService).mock.calls[0][0]).toEqual({
    profiles: services.agentProfileService,
    workspaces: services.agentWorkspaceService,
    authorization: vi.mocked(AuthorizationRepository).mock.instances[0],
    content: services.agentContentAccess,
    tickets: services.agentTicketParameterService,
  });
  expect(services.agentParameterService).toBe(
    vi.mocked(AgentParameterService).mock.instances[0],
  );
  expect(vi.mocked(AgentRunArchive).mock.calls[0]).toEqual([
    vi.mocked(PageAgentRunRepository).mock.instances[0],
    "/srv/pages/Agents",
  ]);
  expect(services.agentRunArchive).toBe(
    vi.mocked(AgentRunArchive).mock.instances[0],
  );
});

it("reads the agent definition files from the current profiles", async () => {
  create();
  const profiles = [opaque("profile")];
  vi.mocked(AgentProfileRepository.prototype.list).mockResolvedValue(
    partial(profiles),
  );

  const [directory, listProfiles] =
    vi.mocked(AgentDefinitionFiles).mock.calls[0];

  expect(directory).toBe("/srv/pages/Agents");
  await expect(listProfiles?.()).resolves.toBe(profiles);
});

it("refuses a ticket context to a missing or inactive account", async () => {
  create();
  const { context } = ticketCallbacks();
  vi.mocked(UserRepository.prototype.findById)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(partial<User>({ id: "user-1", isActive: false }));

  await expect(context("user-1")).rejects.toMatchObject({
    code: "agent_usage_denied",
  });
  await expect(context("user-1")).rejects.toMatchObject({
    code: "agent_usage_denied",
  });
  expect(vi.mocked(createAgentTaskContext)).not.toHaveBeenCalled();
});

it("gives an active account the ticket context of the chat channel", async () => {
  create();
  const { context } = ticketCallbacks();
  const actor = partial<User>({ id: "user-1", isActive: true });
  const taskContext = opaque<ReturnType<typeof createAgentTaskContext>>("ctx");
  vi.mocked(UserRepository.prototype.findById).mockResolvedValue(actor);
  vi.mocked(createAgentTaskContext).mockReturnValue(taskContext);

  await expect(context("user-1")).resolves.toBe(taskContext);
  expect(vi.mocked(UserRepository.prototype.findById)).toHaveBeenCalledWith(
    "user-1",
  );
  expect(vi.mocked(createAgentTaskContext)).toHaveBeenCalledWith(
    DATABASE,
    actor,
    "chat",
  );
});

it("refuses a wiki reference to an unknown or inactive account", async () => {
  create();
  const { wiki } = ticketCallbacks();
  vi.mocked(AuthorizationRepository.prototype.snapshot).mockResolvedValue(
    partial<AuthorizationSnapshot>({
      accounts: [{ userId: "user-2", isActive: false }],
    }),
  );

  await expect(wiki("user-1", "page-1")).rejects.toMatchObject({
    code: "parameter_reference_unavailable",
  });
  await expect(wiki("user-2", "page-1")).rejects.toMatchObject({
    code: "parameter_reference_unavailable",
  });
  expect(vi.mocked(AgentContentAccess.prototype.wiki)).not.toHaveBeenCalled();
});

it("reads a wiki reference with the current account of the user", async () => {
  create();
  const { wiki } = ticketCallbacks();
  const actor = { userId: "user-1", isActive: true };
  vi.mocked(AuthorizationRepository.prototype.snapshot).mockResolvedValue(
    partial<AuthorizationSnapshot>({ accounts: [actor] }),
  );
  vi.mocked(AgentContentAccess.prototype.wiki).mockResolvedValue(
    opaque("wiki page"),
  );

  await expect(wiki("user-1", "page-1")).resolves.toEqual(opaque("wiki page"));
  expect(vi.mocked(AgentContentAccess.prototype.wiki)).toHaveBeenCalledWith(
    actor,
    "page-1",
  );
});
