import { beforeEach, expect, it, vi } from "vitest";

import { createMcpServices } from "@/app/lib/mcp-services.server";
import { runnerAssetUpload } from "@/app/lib/agent-asset-return.server";
import { AgentAssetDownloadService } from "@/backend/service/agents/AgentAssetDownloadService";
import { createAgentAssetReaders } from "@/backend/service/agents/AgentAssetReaders";
import { AgentTicketUploadService } from "@/backend/service/agents/AgentTicketUploadService";
import { TicketAssetAuditService } from "@/backend/service/task/TicketAssetAuditService";
import { AgentPlanTemplateService } from "@/backend/service/agents/AgentPlanTemplateService";
import { AgentPlanTemplateRepository } from "@/backend/database/repositories/agent/AgentPlanTemplateRepository";
import { AgentChatSessionOperationService } from "@/backend/service/agents/AgentChatSessionOperationService";
import { ChatSessionService } from "@/backend/service/chat/ChatSessionService";
import { ChatSettingsService } from "@/backend/service/chat/ChatSettingsService";
import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import { ChatAttachmentRepository } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import { ChatSettingsRepository } from "@/backend/database/repositories/chat/ChatSettingsRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { AgentAssetRepository } from "@/backend/database/repositories/agents/AgentAssetRepository";
import { AgentAssetService } from "@/backend/service/agents/AgentAssetService";
import { createAgentPlanningServices } from "@/backend/service/agents/AgentPlanningServices";
import { AgentUploadAuthorityService } from "@/backend/service/agents/AgentUploadAuthorityService";
import { AgentUploadTicketService } from "@/backend/service/agents/AgentUploadTicketService";
import { AgentWikiCommentService } from "@/backend/service/agents/AgentWikiCommentService";
import { AgentWikiCreateService } from "@/backend/service/agents/AgentWikiCreateService";
import { AgentWikiFieldService } from "@/backend/service/agents/AgentWikiFieldService";
import { AgentWriteOperationService } from "@/backend/service/agents/AgentWriteOperationService";
import { StructuredImportService } from "@/backend/service/agents/StructuredImportService";
import { WikiImportService } from "@/backend/service/agents/WikiImportService";
import { WikiImportUpdateService } from "@/backend/service/agents/WikiImportUpdateService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { AgentExtensionService } from "@/backend/service/agents/AgentExtensionService";
import { AgentAdministrationService } from "@/backend/service/agents/AgentAdministrationService";
import { AgentProjectDeletionService } from "@/backend/service/agents/AgentProjectDeletionService";
import { ProjectDeletionStorage } from "@/backend/service/project/ProjectDeletionStorage";
import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import { AgentWorkspaceOperationService } from "@/backend/service/agents/AgentWorkspaceOperationService";
import { AgentPlanOperationService } from "@/backend/service/agents/AgentPlanOperationService";
import { ChatAgentOperationService } from "@/backend/service/agents/ChatAgentOperationService";
import { PageAgentOperationService } from "@/backend/service/agents/PageAgentOperationService";
import { AgentRunCredentialRepository } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";
import { OAuthRepository } from "@/backend/database/repositories/mcp/OAuthRepository";
import { PersonalAgentTokenRepository } from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";
import { PairingRepository } from "@/backend/database/repositories/mcp/PairingRepository";
import { PairingService } from "@/backend/service/mcp/PairingService";
import { AgentPlanWorkGate } from "@/backend/service/agents/AgentPlanWorkGate";
import { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";
import { AgentProjectService } from "@/backend/service/mcp/AgentProjectService";
import { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import { OAuthService } from "@/backend/service/mcp/OAuthService";
import { PersonalAgentTokenService } from "@/backend/service/mcp/PersonalAgentTokenService";

import type { AgentPlanningServices } from "@/backend/service/agents/AgentPlanningServices";
import type { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import type { Database } from "@/backend/database/Database";

const { fakeClass, fakeClasses, instanceBuiltWith, opaque, partial } =
  await vi.hoisted(async () => import("./service-wiring-fakes"));

vi.mock("@/app/lib/agent-asset-return.server", () => ({
  runnerAssetUpload: vi.fn(),
}));
vi.mock("@/backend/service/agents/AgentAssetDownloadService", () =>
  fakeClasses({ AgentAssetDownloadService: [] }),
);
vi.mock("@/backend/service/agents/AgentAssetReaders", () => ({
  createAgentAssetReaders: vi.fn(),
}));
vi.mock("@/backend/service/agents/AgentTicketUploadService", () =>
  fakeClasses({ AgentTicketUploadService: [] }),
);
vi.mock("@/backend/service/task/TicketAssetAuditService", () =>
  fakeClasses({ TicketAssetAuditService: ["referencedUploadIds"] }),
);
vi.mock("@/backend/service/agents/AgentPlanTemplateService", () =>
  fakeClasses({ AgentPlanTemplateService: [] }),
);
vi.mock(
  "@/backend/database/repositories/agent/AgentPlanTemplateRepository",
  () => fakeClasses({ AgentPlanTemplateRepository: [] }),
);
vi.mock("@/backend/service/agents/AgentChatSessionOperationService", () =>
  fakeClasses({ AgentChatSessionOperationService: [] }),
);
vi.mock("@/backend/service/chat/ChatSessionService", () =>
  fakeClasses({ ChatSessionService: [] }),
);
vi.mock("@/backend/service/chat/ChatSettingsService", () =>
  fakeClasses({ ChatSettingsService: [] }),
);
vi.mock("@/backend/database/repositories/chat/ChatSessionRepository", () =>
  fakeClasses({ ChatSessionRepository: [] }),
);
vi.mock("@/backend/database/repositories/chat/ChatAttachmentRepository", () =>
  fakeClasses({ ChatAttachmentRepository: [] }),
);
vi.mock("@/backend/database/repositories/chat/ChatSettingsRepository", () =>
  fakeClasses({ ChatSettingsRepository: [] }),
);
vi.mock("@/backend/database/repositories/UserSettingsRepository", () =>
  fakeClasses({ UserSettingsRepository: [] }),
);
vi.mock("@/backend/database/repositories/agents/AgentAssetRepository", () =>
  fakeClasses({ AgentAssetRepository: [] }),
);
vi.mock("@/backend/service/agents/AgentAssetService", () =>
  fakeClasses({ AgentAssetService: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanningServices", () => ({
  createAgentPlanningServices: vi.fn(),
}));
vi.mock("@/backend/service/agents/AgentUploadAuthorityService", () =>
  fakeClasses({ AgentUploadAuthorityService: ["verify"] }),
);
vi.mock("@/backend/service/agents/AgentUploadTicketService", () =>
  fakeClasses({ AgentUploadTicketService: [] }),
);
vi.mock("@/backend/service/agents/AgentWikiCommentService", () =>
  fakeClasses({ AgentWikiCommentService: [] }),
);
vi.mock("@/backend/service/agents/AgentWikiCreateService", () =>
  fakeClasses({ AgentWikiCreateService: [] }),
);
vi.mock("@/backend/service/agents/AgentWikiFieldService", () =>
  fakeClasses({ AgentWikiFieldService: [] }),
);
vi.mock("@/backend/service/agents/AgentWriteOperationService", () =>
  fakeClasses({ AgentWriteOperationService: [] }),
);
vi.mock("@/backend/service/agents/StructuredImportService", () =>
  fakeClasses({ StructuredImportService: [] }),
);
vi.mock("@/backend/service/agents/WikiImportService", () =>
  fakeClasses({ WikiImportService: [] }),
);
vi.mock("@/backend/service/agents/WikiImportUpdateService", () =>
  fakeClasses({ WikiImportUpdateService: [] }),
);
vi.mock("@/backend/cache/ServerCache", () => ({
  ServerCache: Object.assign(fakeClass(), { disabled: vi.fn() }),
}));
vi.mock("@/backend/service/events/PagesEventPublisher", () =>
  fakeClasses({ PagesEventPublisher: [] }),
);
vi.mock("@/backend/storage/WikiFileStore", () =>
  fakeClasses({ WikiFileStore: [] }),
);
vi.mock("@/backend/database/repositories/WikiRepository", () =>
  fakeClasses({ WikiRepository: [] }),
);
vi.mock("@/backend/service/agents/AgentExtensionService", () =>
  fakeClasses({ AgentExtensionService: [] }),
);
vi.mock("@/backend/service/agents/AgentAdministrationService", () =>
  fakeClasses({ AgentAdministrationService: [] }),
);
vi.mock("@/backend/service/agents/AgentProjectDeletionService", () =>
  fakeClasses({ AgentProjectDeletionService: [] }),
);
vi.mock("@/backend/service/project/ProjectDeletionStorage", () =>
  fakeClasses({ ProjectDeletionStorage: [] }),
);
vi.mock("@/backend/service/agents/AgentOperationRouter", () =>
  fakeClasses({ AgentOperationRouter: [] }),
);
vi.mock("@/backend/service/agents/AgentWorkspaceOperationService", () =>
  fakeClasses({ AgentWorkspaceOperationService: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanOperationService", () =>
  fakeClasses({ AgentPlanOperationService: [] }),
);
vi.mock("@/backend/service/agents/ChatAgentOperationService", () =>
  fakeClasses({ ChatAgentOperationService: [] }),
);
vi.mock("@/backend/service/agents/PageAgentOperationService", () =>
  fakeClasses({ PageAgentOperationService: [] }),
);
vi.mock(
  "@/backend/database/repositories/mcp/AgentRunCredentialRepository",
  () => fakeClasses({ AgentRunCredentialRepository: [] }),
);
vi.mock("@/backend/database/repositories/mcp/OAuthRepository", () =>
  fakeClasses({ OAuthRepository: [] }),
);
vi.mock(
  "@/backend/database/repositories/mcp/PersonalAgentTokenRepository",
  () => fakeClasses({ PersonalAgentTokenRepository: [] }),
);
vi.mock("@/backend/database/repositories/mcp/PairingRepository", () =>
  fakeClasses({ PairingRepository: [] }),
);
vi.mock("@/backend/service/mcp/PairingService", () =>
  fakeClasses({ PairingService: [] }),
);
vi.mock("@/backend/service/agents/AgentPlanWorkGate", () =>
  fakeClasses({ AgentPlanWorkGate: [] }),
);
vi.mock("@/backend/service/PagesAgentApiService", () =>
  fakeClasses({ PagesAgentApiService: [] }),
);
vi.mock("@/backend/database/repositories/ProjectRepository", () =>
  fakeClasses({ ProjectRepository: [] }),
);
vi.mock("@/backend/service/mcp/AgentIdentityService", () =>
  fakeClasses({ AgentIdentityService: [] }),
);
vi.mock("@/backend/service/mcp/AgentProjectService", () =>
  fakeClasses({ AgentProjectService: [] }),
);
vi.mock("@/backend/service/mcp/AgentRunCredentialService", () =>
  fakeClasses({ AgentRunCredentialService: [] }),
);
vi.mock("@/backend/service/mcp/OAuthService", () =>
  fakeClasses({ OAuthService: [] }),
);
vi.mock("@/backend/service/mcp/PersonalAgentTokenService", () =>
  fakeClasses({ PersonalAgentTokenService: [] }),
);

type Workspace = Parameters<typeof createMcpServices>[3];

type Users = Parameters<typeof createMcpServices>[1];
type Administration = Parameters<typeof createMcpServices>[2];

const DATABASE = opaque<Database>("database");
const USERS = opaque<Users>("users");
const ADMINISTRATION = opaque<Administration>("administration");
const DIRECTORY = "/srv/pages/data";
const PLANNING = partial<AgentPlanningServices>({
  reads: opaque("planning reads"),
  announcer: opaque("planning announcer"),
});
const FOR_CHANNEL = vi.fn<AgentWorkspaceService["forChannel"]>();

/** The workspace input; the optional ticket and event parts are given per test. */
function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    directory: DIRECTORY,
    wikiService: opaque("wiki service"),
    agentWorkspaces: partial({ forChannel: FOR_CHANNEL }),
    pageAgents: opaque("page agents"),
    plans: opaque("plans"),
    planRecovery: opaque("plan recovery"),
    ...overrides,
  };
}

function create(input = workspace()): ReturnType<typeof createMcpServices> {
  return createMcpServices(DATABASE, USERS, ADMINISTRATION, input);
}

/** The options of the operation router of the chat (first) or MCP (second). */
function routerOptions(
  index: 0 | 1,
): ConstructorParameters<typeof AgentOperationRouter>[0] {
  return vi.mocked(AgentOperationRouter).mock.calls[index][0];
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createAgentPlanningServices).mockReturnValue(PLANNING);
  vi.mocked(ServerCache.disabled).mockReturnValue(opaque("disabled cache"));
  FOR_CHANNEL.mockReturnValue(opaque("mcp workspaces"));
  vi.mocked(createAgentAssetReaders).mockReturnValue(opaque("readers"));
  vi.mocked(runnerAssetUpload).mockReturnValue(opaque("upload"));
});

it("uses a disabled cache, no publisher and its own events without ticket parts", () => {
  const services = create();

  const [events] = vi.mocked(PagesEventPublisher).mock.instances;
  expect(services.pagesEventPublisher).toBe(events);
  const [chatPlanning, mcpPlanning] = vi.mocked(createAgentPlanningServices)
    .mock.calls;
  for (const [context] of [chatPlanning, mcpPlanning]) {
    expect(context).toMatchObject({
      database: DATABASE,
      directory: DIRECTORY,
      events,
      cache: opaque("disabled cache"),
      publisher: null,
      users: USERS,
    });
  }
  expect(chatPlanning[0]).toMatchObject({ channel: "chat" });
  expect(mcpPlanning[0]).not.toHaveProperty("channel");
  expect(vi.mocked(AgentProjectDeletionService).mock.calls[0][0]).toMatchObject(
    { cache: opaque("disabled cache") },
  );
});

it("shares the ticket cache, publisher and events of the interface", () => {
  const tickets = {
    cache: opaque<ServerCache>("cache"),
    publisher:
      opaque<NonNullable<Workspace["tickets"]>["publisher"]>("publisher"),
  };
  const events = opaque<PagesEventPublisher>("events");
  const services = create(workspace({ tickets, events }));

  expect(vi.mocked(PagesEventPublisher)).not.toHaveBeenCalled();
  expect(ServerCache.disabled).not.toHaveBeenCalled();
  expect(services.pagesEventPublisher).toBe(events);
  expect(vi.mocked(createAgentPlanningServices).mock.calls[0][0]).toMatchObject(
    { events, cache: tickets.cache, publisher: tickets.publisher },
  );
  expect(vi.mocked(AgentProjectDeletionService).mock.calls[0][0]).toEqual({
    cache: tickets.cache,
    database: DATABASE,
    effects: vi.mocked(ProjectDeletionStorage).mock.instances[0],
  });
  expect(vi.mocked(ProjectDeletionStorage).mock.calls).toEqual([
    [opaque("plans"), DIRECTORY],
  ]);
});

it("authorizes personal tokens, pairing and OAuth with fresh identities", () => {
  const services = create();

  const [identities] = vi.mocked(AgentIdentityService).mock.instances;
  expect(vi.mocked(AgentIdentityService).mock.calls).toEqual([
    [USERS, ADMINISTRATION],
  ]);
  expect(vi.mocked(PersonalAgentTokenService).mock.calls[0]).toEqual([
    vi.mocked(PersonalAgentTokenRepository).mock.instances[0],
    identities,
  ]);
  expect(vi.mocked(PairingService).mock.calls[0]).toEqual([
    vi.mocked(PairingRepository).mock.instances[0],
    identities,
  ]);
  expect(vi.mocked(OAuthService).mock.calls[0][0]).toEqual({
    repository: vi.mocked(OAuthRepository).mock.instances[0],
    identities,
    personal: services.personalAgentTokenService,
    pairing: services.pairingService,
  });
  expect(services.oauthService).toBe(vi.mocked(OAuthService).mock.instances[0]);
  expect(services.personalAgentTokenService).toBe(
    vi.mocked(PersonalAgentTokenService).mock.instances[0],
  );
  expect(services.pairingService).toBe(
    vi.mocked(PairingService).mock.instances[0],
  );
  for (const repository of [
    PersonalAgentTokenRepository,
    PairingRepository,
    OAuthRepository,
  ]) {
    expect(vi.mocked(repository).mock.calls).toEqual([[DATABASE]]);
  }
});

it("stages agent assets next to the database and keeps referenced ticket uploads", async () => {
  const input = workspace();
  const services = create(input);

  const staging = instanceBuiltWith(
    vi.mocked(WikiFileStore),
    "/srv/pages/data/agent-assets",
  );
  const [options] = vi.mocked(AgentAssetService).mock.calls[0];
  expect(options).toMatchObject({
    repository: vi.mocked(AgentAssetRepository).mock.instances[0],
    files: staging,
    wiki: input.wikiService,
  });
  expect(services.agentAssetService).toBe(
    vi.mocked(AgentAssetService).mock.instances[0],
  );
  vi.mocked(
    TicketAssetAuditService.prototype.referencedUploadIds,
  ).mockResolvedValue(new Set(["upload-1"]));
  await expect(options.referencedTicketUploads?.()).resolves.toEqual(
    new Set(["upload-1"]),
  );
  expect(vi.mocked(TicketAssetAuditService).mock.calls).toEqual([
    [DATABASE, DIRECTORY],
  ]);
  expect(vi.mocked(AgentTicketUploadService).mock.calls).toEqual([
    [DATABASE, DIRECTORY, input.wikiService],
  ]);
  expect(services.agentTicketUploadService).toBe(
    vi.mocked(AgentTicketUploadService).mock.instances[0],
  );
});

it("verifies upload and download tickets with personal tokens and run credentials", async () => {
  const input = workspace();
  const services = create(input);

  expect(vi.mocked(AgentRunCredentialService).mock.calls[0]).toEqual([
    vi.mocked(AgentRunCredentialRepository).mock.instances[0],
    vi.mocked(AgentIdentityService).mock.instances[0],
  ]);
  expect(vi.mocked(AgentUploadAuthorityService).mock.calls[0]).toEqual([
    services.personalAgentTokenService,
    vi.mocked(AgentRunCredentialService).mock.instances[0],
  ]);
  vi.mocked(AgentUploadAuthorityService.prototype.verify).mockResolvedValue(
    opaque("authority"),
  );
  const [verifyUpload] = vi.mocked(AgentUploadTicketService).mock.calls[0];
  await expect(verifyUpload("hash-1", 1_000)).resolves.toEqual(
    opaque("authority"),
  );
  const [downloads] = vi.mocked(AgentAssetDownloadService).mock.calls[0];
  await expect(downloads.verify("hash-2")).resolves.toEqual(
    opaque("authority"),
  );
  expect(AgentUploadAuthorityService.prototype.verify).toHaveBeenNthCalledWith(
    1,
    "hash-1",
  );
  expect(AgentUploadAuthorityService.prototype.verify).toHaveBeenNthCalledWith(
    2,
    "hash-2",
  );
  expect(downloads).toMatchObject({ users: USERS, assets: opaque("readers") });
  expect(createAgentAssetReaders).toHaveBeenCalledWith({
    database: DATABASE,
    directory: DIRECTORY,
    wiki: input.wikiService,
    assets: services.agentAssetService,
  });
  expect(services.agentUploadTicketService).toBe(
    vi.mocked(AgentUploadTicketService).mock.instances[0],
  );
  expect(services.agentAssetDownloadService).toBe(
    vi.mocked(AgentAssetDownloadService).mock.instances[0],
  );
});

it("serves the agent API over the MCP catalog with run, download and upload capabilities", async () => {
  const services = create();

  expect(services.pagesAgentApiService).toBe(
    vi.mocked(PagesAgentApiService).mock.instances[0],
  );
  expect(vi.mocked(PagesAgentApiService).mock.calls[0]).toEqual([
    services.personalAgentTokenService,
    vi.mocked(AgentProjectService).mock.instances[0],
    vi.mocked(AgentOperationRouter).mock.instances[1],
    {
      runs: vi.mocked(AgentRunCredentialService).mock.instances[0],
      workGate: vi.mocked(AgentPlanWorkGate).mock.instances[0],
      downloads: services.agentAssetDownloadService,
      upload: opaque("upload"),
    },
  ]);
  expect(vi.mocked(AgentProjectService).mock.calls[0][0]).toBe(
    vi.mocked(ProjectRepository).mock.instances[2],
  );
  expect(vi.mocked(AgentPlanWorkGate).mock.calls).toEqual([[DATABASE, USERS]]);
  const [uploadServices] = vi.mocked(runnerAssetUpload).mock.calls[0];
  await expect(uploadServices()).resolves.toEqual({
    agentUploadTicketService: services.agentUploadTicketService,
    agentTicketUploadService: services.agentTicketUploadService,
    agentAssetService: services.agentAssetService,
  });
});

it("lets MCP clients manage their own chat sessions with confirmation", () => {
  create();

  const chatFiles = instanceBuiltWith(
    vi.mocked(WikiFileStore),
    "/srv/pages/data/chat-attachments",
  );
  expect(vi.mocked(ChatSettingsService).mock.calls[0]).toEqual([
    vi.mocked(ChatSettingsRepository).mock.instances[0],
    ADMINISTRATION,
  ]);
  expect(vi.mocked(ChatSessionService).mock.calls[0][0]).toEqual({
    sessions: vi.mocked(ChatSessionRepository).mock.instances[0],
    attachments: vi.mocked(ChatAttachmentRepository).mock.instances[0],
    settings: vi.mocked(ChatSettingsService).mock.instances[0],
    languages: vi.mocked(UserSettingsRepository).mock.instances[0],
    files: chatFiles,
  });
  expect(vi.mocked(AgentChatSessionOperationService).mock.calls[0][0]).toEqual({
    users: USERS,
    sessions: vi.mocked(ChatSessionService).mock.instances[0],
  });
  expect(routerOptions(1).chatSessions).toBe(
    vi.mocked(AgentChatSessionOperationService).mock.instances[0],
  );
  expect(routerOptions(0).chatSessions).toBe(undefined);
});

it("gives the chat the shared catalog on the chat channel without imports", () => {
  const input = workspace();
  const services = create(input);

  const options = routerOptions(0);
  expect(services.chatOperationRouter).toBe(
    vi.mocked(AgentOperationRouter).mock.instances[0],
  );
  expect(options).toMatchObject({
    channel: "chat",
    planning: PLANNING,
    users: USERS,
    administration: vi.mocked(AgentAdministrationService).mock.instances[0],
    pageAgents: vi.mocked(ChatAgentOperationService).mock.instances[0],
    plans: vi.mocked(AgentPlanOperationService).mock.instances[0],
    writes: vi.mocked(AgentWriteOperationService).mock.instances[0],
    fields: vi.mocked(AgentWikiFieldService).mock.instances[0],
    comments: vi.mocked(AgentWikiCommentService).mock.instances[0],
    extensions: vi.mocked(AgentExtensionService).mock.instances[0],
  });
  for (const absent of [
    "imports",
    "importUpdates",
    "structured",
    "workspaces",
  ]) {
    expect(options).not.toHaveProperty(absent);
  }
  expect(vi.mocked(AgentAdministrationService).mock.calls[0]).toEqual([
    DATABASE,
    opaque("disabled cache"),
    "chat",
  ]);
  expect(vi.mocked(ChatAgentOperationService).mock.calls[0][0]).toEqual({
    database: DATABASE,
    agents: input.pageAgents,
  });
  const creation = vi.mocked(AgentWikiCreateService).mock.calls[0][0];
  expect(creation).toMatchObject({ channel: "chat", database: DATABASE });
  expect(vi.mocked(AgentWikiFieldService).mock.calls[0][0]).toEqual({
    database: DATABASE,
    events: services.pagesEventPublisher,
    channel: "chat",
  });
  expect(vi.mocked(AgentExtensionService).mock.calls[0][0]).toEqual({
    database: DATABASE,
    planning: PLANNING.reads,
    announcer: PLANNING.announcer,
    cache: opaque("disabled cache"),
    channel: "chat",
  });
});

it("plans over the shared plan service, recovery and node templates", () => {
  const input = workspace();
  create(input);

  for (const index of [0, 1]) {
    expect(vi.mocked(AgentPlanOperationService).mock.calls[index][0]).toEqual({
      database: DATABASE,
      plans: input.plans,
      resources: {
        recovery: input.planRecovery,
        plans: input.plans,
        templates: vi.mocked(AgentPlanTemplateService).mock.instances[index],
      },
    });
    expect(vi.mocked(AgentPlanTemplateService).mock.calls[index][0]).toEqual({
      plans: input.plans,
      templates: vi.mocked(AgentPlanTemplateRepository).mock.instances[index],
    });
  }
});

it("gives MCP clients workspaces, imports, uploads and the project deletion", () => {
  const input = workspace();
  const services = create(input);

  const options = routerOptions(1);
  const wikiFiles = instanceBuiltWith(
    vi.mocked(WikiFileStore),
    "/srv/pages/data/wiki-attachments",
  );
  const creation = {
    database: DATABASE,
    staging: instanceBuiltWith(
      vi.mocked(WikiFileStore),
      "/srv/pages/data/agent-assets",
    ),
    wikiFiles,
    events: services.pagesEventPublisher,
  };
  expect(options).not.toHaveProperty("channel");
  expect(options).toMatchObject({
    projectDeletion: vi.mocked(AgentProjectDeletionService).mock.instances[0],
    workspaces: vi.mocked(AgentWorkspaceOperationService).mock.instances[0],
    pageAgents: vi.mocked(PageAgentOperationService).mock.instances[0],
    projects: vi.mocked(ProjectRepository).mock.instances[1],
    wiki: vi.mocked(WikiRepository).mock.instances[1],
    imports: vi.mocked(WikiImportService).mock.instances[0],
    importUpdates: vi.mocked(WikiImportUpdateService).mock.instances[0],
    structured: vi.mocked(StructuredImportService).mock.instances[0],
    planning: PLANNING,
  });
  expect(FOR_CHANNEL).toHaveBeenCalledWith("mcp");
  expect(vi.mocked(AgentWorkspaceOperationService).mock.calls[0][0]).toEqual({
    database: DATABASE,
    workspaces: opaque("mcp workspaces"),
  });
  expect(vi.mocked(PageAgentOperationService).mock.calls[0][0]).toEqual({
    database: DATABASE,
    agents: input.pageAgents,
  });
  expect(vi.mocked(AgentAdministrationService).mock.calls[1]).toEqual([
    DATABASE,
    opaque("disabled cache"),
  ]);
  expect(vi.mocked(WikiImportService).mock.calls).toEqual([[creation]]);
  expect(vi.mocked(WikiImportUpdateService).mock.calls).toEqual([[creation]]);
  expect(vi.mocked(StructuredImportService).mock.calls).toEqual([
    [{ creation, planning: PLANNING }],
  ]);
  expect(vi.mocked(AgentWikiCreateService).mock.calls[1]).toEqual([creation]);
  expect(vi.mocked(AgentWriteOperationService).mock.calls[1][0]).toEqual({
    users: USERS,
    tickets: services.agentUploadTicketService,
    assets: services.agentAssetService,
    ticketUploads: services.agentTicketUploadService,
    wiki: input.wikiService,
    create: vi.mocked(AgentWikiCreateService).mock.instances[1],
  });
  expect(vi.mocked(AgentWikiCommentService).mock.calls[1][0]).toEqual({
    database: DATABASE,
    events: services.pagesEventPublisher,
    channel: "mcp",
  });
});
