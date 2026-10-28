import { vi } from "vitest";

import { startExecutionServices } from "@/app/lib/agent-execution-services.server";
import { createAgentPlanService } from "@/app/lib/agent-plan-services.server";
import { createChatServices } from "@/app/lib/chat-services.server";
import { createDiscordServices } from "@/app/lib/discord-services.server";
import { createMcpServices } from "@/app/lib/mcp-services.server";
import { createPreferenceServices } from "@/app/lib/preference-services.server";
import { Database } from "@/backend/database/Database";
import { resolveGitHubTokenKey } from "@/backend/github/GitHubTokenKey";
import { pagesMcpBundlePath } from "@/backend/agents/cli/PagesMcpBundle";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";

import type { Mock } from "vitest";
import type { AgentApplicationServices } from "@/app/lib/agent-services.server";
import type { AgentPlanServices } from "@/app/lib/agent-plan-services.server";
import type { ChatApplicationServices } from "@/app/lib/chat-services.server";
import type { DiscordApplicationServices } from "@/app/lib/discord-services.server";
import type { McpApplicationServices } from "@/app/lib/mcp-services.server";
import type { PreferenceApplicationServices } from "@/app/lib/preference-services.server";
import type { PagesRuntime } from "@/backend/runtime/PagesRuntime";

const { fakeClass, fakeClasses, opaque, partial } = await vi.hoisted(
  async () => import("./service-wiring-fakes"),
);

// The application services are composed from these boundaries only; nothing
// opens a database, a file, a process or a socket.
vi.mock("@/backend/database/Database", () => ({
  Database: Object.assign(fakeClass(["migrate", "close"]), {
    create: vi.fn(),
  }),
}));
vi.mock("@/backend/database/Migrations", () => ({
  DATABASE_MIGRATIONS: [{ version: 1, name: "synthetic", sql: "" }],
}));
vi.mock("@/backend/runtime/ProcessLifecycle", () => ({
  registerShutdownTask: vi.fn(),
}));
vi.mock("@/backend/github/GitHubTokenKey", () => ({
  resolveGitHubTokenKey: vi.fn(),
}));
vi.mock("@/backend/runtime/PagesRuntime", () => ({
  getPagesRuntime: vi.fn(),
}));
vi.mock("@/backend/service/chat/acp/PicaAcpWorkspace", () => ({
  PICA_WORKSPACE_DIRECTORY_NAME: "pica-sessions",
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
  logEvent: vi.fn(),
}));
vi.mock("@/backend/agents/cli/PagesMcpBundle", () => ({
  pagesMcpBundlePath: vi.fn(),
}));
vi.mock("@/app/lib/agent-execution-services.server", () => ({
  startExecutionServices: vi.fn(),
}));
vi.mock("@/app/lib/chat-services.server", () => ({
  createChatServices: vi.fn(),
}));
vi.mock("@/app/lib/agent-plan-services.server", () => ({
  createAgentPlanService: vi.fn(),
}));
vi.mock("@/app/lib/mcp-services.server", () => ({
  createMcpServices: vi.fn(),
}));
vi.mock("@/app/lib/discord-services.server", () => ({
  createDiscordServices: vi.fn(),
}));
vi.mock("@/app/lib/preference-services.server", () => ({
  createPreferenceServices: vi.fn(),
}));
vi.mock("@/backend/service/task/TicketAssetAuditService", () =>
  fakeClasses({ TicketAssetAuditService: [] }),
);
vi.mock("@/backend/auth/AuthService", () => fakeClasses({ AuthService: [] }));
vi.mock("@/backend/auth/LoginThrottle", () =>
  fakeClasses({ LoginThrottle: [] }),
);
vi.mock("@/backend/auth/PasswordHasher", () =>
  fakeClasses({ PasswordHasher: [] }),
);
vi.mock("@/backend/auth/PermissionService", () =>
  fakeClasses({ PermissionService: [] }),
);
vi.mock("@/backend/auth/SessionService", () =>
  fakeClasses({ SessionService: ["removeExpiredSessions"] }),
);
vi.mock("@/backend/cache/ServerCache", () => fakeClasses({ ServerCache: [] }));
vi.mock("@/backend/github/GitHubSyncScheduler", () =>
  fakeClasses({ GitHubSyncScheduler: ["start", "stop"] }),
);
vi.mock("@/backend/database/repositories/SessionRepository", () =>
  fakeClasses({ SessionRepository: [] }),
);
vi.mock("@/backend/database/repositories/AuthorizationRepository", () =>
  fakeClasses({ AuthorizationRepository: [] }),
);
vi.mock("@/backend/service/AdministrationService", () =>
  fakeClasses({ AdministrationService: ["getContext"] }),
);
vi.mock("@/backend/service/GroupAdministrationService", () =>
  fakeClasses({ GroupAdministrationService: [] }),
);
vi.mock("@/backend/database/repositories/InstanceSettingsRepository", () =>
  fakeClasses({ InstanceSettingsRepository: [] }),
);
vi.mock("@/backend/database/repositories/GitHubRepository", () =>
  fakeClasses({ GitHubRepository: [] }),
);
vi.mock("@/backend/database/repositories/ProjectRepository", () =>
  fakeClasses({ ProjectRepository: [] }),
);
vi.mock("@/backend/database/repositories/TaskRepository", () =>
  fakeClasses({ TaskRepository: [] }),
);
vi.mock(
  "@/backend/database/repositories/task/WorkItemAttachmentRepository",
  () => fakeClasses({ WorkItemAttachmentRepository: [] }),
);
vi.mock("@/backend/database/repositories/task/WorkItemTemplateRepository", () =>
  fakeClasses({ WorkItemTemplateRepository: [] }),
);
vi.mock("@/backend/database/repositories/task/WorkItemTreeRepository", () =>
  fakeClasses({ WorkItemTreeRepository: [] }),
);
vi.mock("@/backend/database/repositories/UserRepository", () =>
  fakeClasses({ UserRepository: [] }),
);
vi.mock("@/backend/database/repositories/WikiRepository", () =>
  fakeClasses({ WikiRepository: [] }),
);
vi.mock("@/backend/service/HealthService", () =>
  fakeClasses({ HealthService: [] }),
);
vi.mock("@/backend/service/InstanceSettingsService", () =>
  fakeClasses({ InstanceSettingsService: [] }),
);
vi.mock("@/backend/service/GitHubSyncService", () =>
  fakeClasses({ GitHubSyncService: [] }),
);
vi.mock("@/backend/service/ProjectService", () =>
  fakeClasses({ ProjectService: ["setDeletionEffects"] }),
);
vi.mock("@/backend/service/project/ProjectDeletionStorage", () =>
  fakeClasses({ ProjectDeletionStorage: [] }),
);
vi.mock("@/backend/service/AnnouncingTaskService", () =>
  fakeClasses({
    AnnouncingTaskService: [
      "setGitHubSync",
      "setAttachmentFiles",
      "setDescriptionAssets",
    ],
  }),
);
vi.mock("@/backend/service/events/PagesEventPublisher", () =>
  fakeClasses({ PagesEventPublisher: [] }),
);
vi.mock("@/backend/service/task/TaskGitHubPublisher", () =>
  fakeClasses({ TaskGitHubPublisher: ["attach"] }),
);
vi.mock("@/backend/service/task/TaskHistoryRecorder", () =>
  fakeClasses({ TaskHistoryRecorder: [] }),
);
vi.mock("@/backend/service/TaskTemplateService", () =>
  fakeClasses({ TaskTemplateService: [] }),
);
vi.mock("@/backend/service/task/TaskDescriptionAssetService", () =>
  fakeClasses({ TaskDescriptionAssetService: [] }),
);
vi.mock("@/backend/service/task/TaskAttachmentService", () =>
  fakeClasses({ TaskAttachmentService: ["sweep"] }),
);
vi.mock("@/backend/service/task/TicketTreeService", () =>
  fakeClasses({ TicketTreeService: [] }),
);
vi.mock("@/backend/service/UserService", () =>
  fakeClasses({ UserService: [] }),
);
vi.mock("@/backend/service/wiki/WikiMaintenanceScheduler", () =>
  fakeClasses({ WikiMaintenanceScheduler: ["start", "stop"] }),
);
vi.mock("@/backend/service/WikiService", () =>
  fakeClasses({ WikiService: ["runMaintenance"] }),
);
vi.mock("@/backend/storage/TicketFileStore", () =>
  fakeClasses({ TicketFileStore: [] }),
);
vi.mock("@/backend/storage/WikiFileStore", () =>
  fakeClasses({ WikiFileStore: [] }),
);
vi.mock("@/backend/setup/SetupService", () =>
  fakeClasses({ SetupService: ["migrateLegacyBootstrapAdministrator"] }),
);

/** The path of the synthetic database; every instance folder lies next to it. */
export const DATABASE_PATH = "/srv/pages/data/pages.db";

/** The collaborators the application services are composed from, with a shared log of shutdown steps. */
export interface ServicesWorld {
  readonly database: Database;
  readonly agents: AgentApplicationServices;
  readonly plans: AgentPlanServices;
  readonly mcp: McpApplicationServices;
  readonly chat: ChatApplicationServices;
  readonly discord: DiscordApplicationServices;
  readonly preferences: PreferenceApplicationServices;
  readonly tokenKey: Buffer;
  /** The names of the shutdown steps, in the order they ran. */
  readonly shutdownSteps: string[];
  /** The step of that name; a test makes one fail through it. */
  readonly shutdownStep: (name: string) => Mock<() => Promise<void>>;
}

function shutdownSteps(): {
  readonly steps: string[];
  readonly step: (name: string) => Mock<() => Promise<void>>;
} {
  const steps: string[] = [];
  const mocks = new Map<string, Mock<() => Promise<void>>>();
  const step = (name: string): Mock<() => Promise<void>> => {
    const existing = mocks.get(name);
    if (existing) return existing;
    const created = vi.fn(async () => {
      steps.push(name);
    });
    mocks.set(name, created);
    return created;
  };
  return { steps, step };
}

function agentServices(
  step: (name: string) => Mock<() => Promise<void>>,
): AgentApplicationServices {
  return partial<AgentApplicationServices>({
    chatRequests: { shutdown: step("chat requests") },
    acpResourceScheduler: { shutdown: step("acp resources") },
    agentCatalogScheduler: { shutdown: step("catalog scheduler") },
    agentToolManagerService: { shutdown: step("tool manager") },
    agentToolStartupService: { shutdown: step("tool startup") },
    agentCliLoginService: { shutdown: step("cli login") },
    remoteConsoleService: { shutdown: step("remote console") },
    remoteSessions: { shutdown: step("remote sessions") },
    sshClient: { dispose: step("ssh client") },
    agentWorkspaceService: opaque("agent workspaces"),
    pageAgentService: opaque("page agents"),
  });
}

/** The runtime of the configured instance on port 3100. */
export function runtimeFixture(publicUrl?: string): PagesRuntime {
  return partial<PagesRuntime>({
    configFile: { path: "/srv/pages/config.json" },
    getConfig: () => ({ port: 3100, mcpHttp: { publicUrl } }),
    getDatabasePath: () => DATABASE_PATH,
  });
}

/**
 * Creates fresh collaborators, lets the mocked factories return them and
 * forgets the process-wide services and schedulers of an earlier test.
 *
 * @returns The collaborators and the shutdown log.
 */
export function servicesWorld(): ServicesWorld {
  globalThis.pagesServices = undefined;
  globalThis.pagesShutdownHandlerRegistered = undefined;
  globalThis.pagesSyncSchedulerStarted = undefined;
  globalThis.pagesWikiMaintenanceStarted = undefined;
  const { steps, step } = shutdownSteps();
  const world: ServicesWorld = {
    database: partial<Database>({ migrate: vi.fn(), close: step("database") }),
    agents: agentServices(step),
    plans: partial<AgentPlanServices>({
      agentPlanService: { shutdown: step("plans") },
      agentPlanRecoveryService: opaque("plan recovery"),
      agentSessionService: opaque("plan sessions"),
    }),
    mcp: partial<McpApplicationServices>({
      agentAssetService: { runMaintenance: vi.fn(async () => undefined) },
      chatOperationRouter: opaque("chat router"),
      pagesAgentApiService: opaque("agent api"),
    }),
    chat: partial<ChatApplicationServices>({ chatService: opaque("chat") }),
    discord: partial<DiscordApplicationServices>({
      discordConnectionService: opaque("discord"),
    }),
    preferences: partial<PreferenceApplicationServices>({
      settingsService: opaque("settings"),
      designThemeService: opaque("design themes"),
      boardPreferencesService: opaque("board preferences"),
    }),
    tokenKey: Buffer.from("token-key"),
    shutdownSteps: steps,
    shutdownStep: step,
  };
  vi.mocked(Database.create).mockResolvedValue(world.database);
  vi.mocked(getPagesRuntime).mockResolvedValue(runtimeFixture());
  vi.mocked(resolveGitHubTokenKey).mockReturnValue(world.tokenKey);
  vi.mocked(pagesMcpBundlePath).mockReturnValue("/srv/pages/mcp/pages-mcp.mjs");
  vi.mocked(startExecutionServices).mockResolvedValue({
    agentServices: world.agents,
  });
  vi.mocked(createAgentPlanService).mockResolvedValue(world.plans);
  vi.mocked(createMcpServices).mockReturnValue(world.mcp);
  vi.mocked(createChatServices).mockReturnValue(world.chat);
  vi.mocked(createDiscordServices).mockReturnValue(world.discord);
  vi.mocked(createPreferenceServices).mockReturnValue(world.preferences);
  return world;
}
