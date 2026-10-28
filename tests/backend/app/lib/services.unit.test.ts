import { beforeEach, expect, it, vi } from "vitest";

import { DATABASE_PATH, servicesWorld } from "./services-fixture";
import {
  activateApplicationServices,
  getApplicationServices,
} from "@/app/lib/services.server";
import { startExecutionServices } from "@/app/lib/agent-execution-services.server";
import { createAgentPlanService } from "@/app/lib/agent-plan-services.server";
import { createChatServices } from "@/app/lib/chat-services.server";
import { createDiscordServices } from "@/app/lib/discord-services.server";
import { createMcpServices } from "@/app/lib/mcp-services.server";
import { createPreferenceServices } from "@/app/lib/preference-services.server";
import { AuthService } from "@/backend/auth/AuthService";
import { LoginThrottle } from "@/backend/auth/LoginThrottle";
import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { PermissionService } from "@/backend/auth/PermissionService";
import { SessionService } from "@/backend/auth/SessionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { Database } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { resolveGitHubTokenKey } from "@/backend/github/GitHubTokenKey";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";
import { InstanceSettingsRepository } from "@/backend/database/repositories/InstanceSettingsRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { WorkItemAttachmentRepository } from "@/backend/database/repositories/task/WorkItemAttachmentRepository";
import { WorkItemTemplateRepository } from "@/backend/database/repositories/task/WorkItemTemplateRepository";
import { WorkItemTreeRepository } from "@/backend/database/repositories/task/WorkItemTreeRepository";
import { logDiagnostic } from "@/backend/logging/Logger";
import { AdministrationService } from "@/backend/service/AdministrationService";
import { AnnouncingTaskService } from "@/backend/service/AnnouncingTaskService";
import { GitHubSyncService } from "@/backend/service/GitHubSyncService";
import { GroupAdministrationService } from "@/backend/service/GroupAdministrationService";
import { HealthService } from "@/backend/service/HealthService";
import { InstanceSettingsService } from "@/backend/service/InstanceSettingsService";
import { ProjectService } from "@/backend/service/ProjectService";
import { TaskTemplateService } from "@/backend/service/TaskTemplateService";
import { UserService } from "@/backend/service/UserService";
import { WikiService } from "@/backend/service/WikiService";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import { ProjectDeletionStorage } from "@/backend/service/project/ProjectDeletionStorage";
import { TaskAttachmentService } from "@/backend/service/task/TaskAttachmentService";
import { TaskDescriptionAssetService } from "@/backend/service/task/TaskDescriptionAssetService";
import { TaskGitHubPublisher } from "@/backend/service/task/TaskGitHubPublisher";
import { TaskHistoryRecorder } from "@/backend/service/task/TaskHistoryRecorder";
import { TicketAssetAuditService } from "@/backend/service/task/TicketAssetAuditService";
import { TicketTreeService } from "@/backend/service/task/TicketTreeService";
import { SetupService } from "@/backend/setup/SetupService";
import { TicketFileStore } from "@/backend/storage/TicketFileStore";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";

import type { ServicesWorld } from "./services-fixture";

const { opaque } = await vi.hoisted(
  async () => import("./service-wiring-fakes"),
);

let world: ServicesWorld;

/** The only instance a fake class created. */
function only<Instance>(fake: {
  readonly mock: { readonly instances: Instance[] };
}): Instance {
  expect(fake.mock.instances).toHaveLength(1);
  return fake.mock.instances[0];
}

beforeEach(() => {
  vi.resetAllMocks();
  world = servicesWorld();
});

it("migrates the database of a finished setup and keeps its services for later requests", async () => {
  const activated = activateApplicationServices(world.database, DATABASE_PATH);

  expect(globalThis.pagesServices).toBe(activated);
  const services = await activated;
  expect(world.database.migrate).toHaveBeenCalledWith(DATABASE_MIGRATIONS);
  await expect(getApplicationServices()).resolves.toBe(services);
  expect(Database.create).not.toHaveBeenCalled();
});

it("returns every service group together with the core services", async () => {
  const services = await activateApplicationServices(
    world.database,
    DATABASE_PATH,
  );

  expect(services).toMatchObject({
    ...world.agents,
    ...world.plans,
    ...world.mcp,
    ...world.chat,
    ...world.discord,
    ...world.preferences,
    administrationService: only(vi.mocked(AdministrationService)),
    groupAdministrationService: only(vi.mocked(GroupAdministrationService)),
    permissionService: only(vi.mocked(PermissionService)),
    passwordHasher: only(vi.mocked(PasswordHasher)),
    projectService: only(vi.mocked(ProjectService)),
    sessionService: only(vi.mocked(SessionService)),
    userService: only(vi.mocked(UserService)),
    healthService: only(vi.mocked(HealthService)),
    instanceSettingsService: only(vi.mocked(InstanceSettingsService)),
    wikiService: only(vi.mocked(WikiService)),
    taskService: only(vi.mocked(AnnouncingTaskService)),
    taskTemplateService: only(vi.mocked(TaskTemplateService)),
    taskAttachmentService: only(vi.mocked(TaskAttachmentService)),
    ticketAssetAuditService: only(vi.mocked(TicketAssetAuditService)),
    ticketTreeService: only(vi.mocked(TicketTreeService)),
    gitHubSyncService: only(vi.mocked(GitHubSyncService)),
    pagesEventPublisher: only(vi.mocked(PagesEventPublisher)),
    authService: only(vi.mocked(AuthService)),
  });
});

it("decides account rights through the administration and one shared cache", async () => {
  await activateApplicationServices(world.database, DATABASE_PATH);

  const repository = only(vi.mocked(AuthorizationRepository));
  const cache = only(vi.mocked(ServerCache));
  const hasher = only(vi.mocked(PasswordHasher));
  expect(vi.mocked(AuthorizationRepository).mock.calls).toEqual([
    [world.database],
  ]);
  expect(vi.mocked(AdministrationService).mock.calls[0]).toEqual([
    repository,
    cache,
    hasher,
  ]);
  expect(vi.mocked(GroupAdministrationService).mock.calls[0]).toEqual([
    repository,
    cache,
  ]);
  vi.mocked(AdministrationService.prototype.getContext).mockResolvedValue(
    opaque("context"),
  );
  const [contextOf] = vi.mocked(PermissionService).mock.calls[0];
  await expect(contextOf?.("user-1")).resolves.toEqual(opaque("context"));
  expect(AdministrationService.prototype.getContext).toHaveBeenCalledWith(
    "user-1",
  );
  expect(vi.mocked(UserService).mock.calls[0]).toEqual([
    only(vi.mocked(UserRepository)),
    only(vi.mocked(PermissionService)),
    only(vi.mocked(AdministrationService)),
  ]);
});

it("keeps preferences, the GitHub token key and the wiki next to the database", async () => {
  await activateApplicationServices(world.database, DATABASE_PATH);

  expect(createPreferenceServices).toHaveBeenCalledWith(
    world.database,
    DATABASE_PATH,
  );
  expect(resolveGitHubTokenKey).toHaveBeenCalledWith(DATABASE_PATH);
  const permissions = only(vi.mocked(PermissionService));
  expect(vi.mocked(ProjectService).mock.calls[0]).toEqual([
    vi.mocked(ProjectRepository).mock.instances[0],
    permissions,
    world.tokenKey,
    only(vi.mocked(ServerCache)),
  ]);
  expect(vi.mocked(WikiService).mock.calls[0]).toEqual([
    only(vi.mocked(WikiRepository)),
    only(vi.mocked(ProjectService)),
    permissions,
    only(vi.mocked(WikiFileStore)),
  ]);
  expect(vi.mocked(WikiFileStore).mock.calls).toEqual([
    ["/srv/pages/data/wiki-attachments"],
  ]);
  expect(vi.mocked(HealthService).mock.calls).toEqual([[world.database]]);
  expect(vi.mocked(InstanceSettingsService).mock.calls[0]).toEqual([
    only(vi.mocked(InstanceSettingsRepository)),
    permissions,
  ]);
});

it("announces ticket changes and synchronizes them with GitHub", async () => {
  await activateApplicationServices(world.database, DATABASE_PATH);

  const [taskRepository] = vi.mocked(TaskRepository).mock.instances;
  const taskService = only(vi.mocked(AnnouncingTaskService));
  const events = only(vi.mocked(PagesEventPublisher));
  const cache = only(vi.mocked(ServerCache));
  const projectService = only(vi.mocked(ProjectService));
  const [projectRepository] = vi.mocked(ProjectRepository).mock.instances;
  expect(vi.mocked(AnnouncingTaskService).mock.calls[0]).toEqual([
    {
      cache,
      permissionService: only(vi.mocked(PermissionService)),
      projectService,
      taskRepository,
    },
    events,
  ]);
  expect(vi.mocked(GitHubSyncService).mock.calls[0][0]).toEqual({
    cache,
    gitHubRepository: only(vi.mocked(GitHubRepository)),
    projectRepository,
    projectService,
    taskRepository,
    taskService,
    tokenKey: world.tokenKey,
    userRepository: only(vi.mocked(UserRepository)),
  });
  expect(AnnouncingTaskService.prototype.setGitHubSync).toHaveBeenCalledWith(
    only(vi.mocked(GitHubSyncService)),
  );
  expect(createDiscordServices).toHaveBeenCalledWith({
    database: world.database,
    events,
    projectRepository,
    projectService,
    taskRepository,
  });
  expect(vi.mocked(TaskTemplateService).mock.calls[0]).toEqual([
    only(vi.mocked(WorkItemTemplateRepository)),
    taskService,
    projectService,
    only(vi.mocked(PermissionService)),
  ]);
});

it("ties ticket attachments, description assets and the tree to ticket access", async () => {
  await activateApplicationServices(world.database, DATABASE_PATH);

  const taskService = only(vi.mocked(AnnouncingTaskService));
  const attachments = only(vi.mocked(TaskAttachmentService));
  expect(vi.mocked(TaskAttachmentService).mock.calls[0]).toEqual([
    only(vi.mocked(WorkItemAttachmentRepository)),
    taskService,
    only(vi.mocked(WikiService)),
    only(vi.mocked(TicketFileStore)),
  ]);
  expect(vi.mocked(TicketFileStore).mock.calls).toEqual([["/srv/pages/data"]]);
  expect(
    AnnouncingTaskService.prototype.setAttachmentFiles,
  ).toHaveBeenCalledWith(attachments);
  expect(vi.mocked(TaskDescriptionAssetService).mock.calls).toEqual([
    [world.database, "/srv/pages/data"],
  ]);
  expect(
    AnnouncingTaskService.prototype.setDescriptionAssets,
  ).toHaveBeenCalledWith(only(vi.mocked(TaskDescriptionAssetService)));
  expect(TaskAttachmentService.prototype.sweep).toHaveBeenCalledOnce();
  expect(vi.mocked(TicketAssetAuditService).mock.calls).toEqual([
    [world.database, "/srv/pages/data"],
  ]);
  expect(vi.mocked(TicketTreeService).mock.calls[0]).toEqual([
    only(vi.mocked(WorkItemTreeRepository)),
    taskService,
  ]);
});

it("starts the agent runtimes with ticket and wiki assets and the token key", async () => {
  await activateApplicationServices(world.database, DATABASE_PATH);

  expect(startExecutionServices).toHaveBeenCalledWith(
    world.database,
    DATABASE_PATH,
    {
      tokenKey: world.tokenKey,
      tickets: only(vi.mocked(TaskAttachmentService)),
      wiki: only(vi.mocked(WikiService)),
    },
  );
});

it("builds the plans on the agents and ends plan runs before a project is deleted", async () => {
  vi.stubEnv("PAGES_AGENT_API_URL", undefined);
  await activateApplicationServices(world.database, DATABASE_PATH);

  const [input] = vi.mocked(createAgentPlanService).mock.calls[0];
  expect(input).toMatchObject({
    database: world.database,
    agents: world.agents,
    tasks: only(vi.mocked(AnnouncingTaskService)),
    users: only(vi.mocked(UserService)),
    mcp: {
      bundle: "/srv/pages/mcp/pages-mcp.mjs",
      url: "http://127.0.0.1:3100",
      node: process.execPath,
    },
  });
  await expect(input.api()).resolves.toEqual(opaque("agent api"));
  expect(vi.mocked(ProjectDeletionStorage).mock.calls).toEqual([
    [world.plans.agentPlanService, "/srv/pages/data"],
  ]);
  expect(ProjectService.prototype.setDeletionEffects).toHaveBeenCalledWith(
    only(vi.mocked(ProjectDeletionStorage)),
  );
});

it("removes expired sessions without a note when no legacy administrator exists", async () => {
  vi.mocked(
    SetupService.prototype.migrateLegacyBootstrapAdministrator,
  ).mockResolvedValue(false);

  await activateApplicationServices(world.database, DATABASE_PATH);

  expect(vi.mocked(SetupService).mock.calls[0]).toEqual([
    only(vi.mocked(UserRepository)),
    only(vi.mocked(PasswordHasher)),
  ]);
  expect(vi.mocked(SessionService).mock.calls[0]).toEqual([
    only(vi.mocked(SessionRepository)),
    only(vi.mocked(UserService)),
  ]);
  expect(SessionService.prototype.removeExpiredSessions).toHaveBeenCalledOnce();
  expect(logDiagnostic).not.toHaveBeenCalled();
});

it("notes the migration of the legacy default administrator", async () => {
  vi.mocked(
    SetupService.prototype.migrateLegacyBootstrapAdministrator,
  ).mockResolvedValue(true);

  await activateApplicationServices(world.database, DATABASE_PATH);

  expect(logDiagnostic).toHaveBeenCalledWith(
    "services",
    "info",
    '[pages] Migrated the default administrator "admin" to the current password hashing algorithm.',
  );
  expect(SessionService.prototype.removeExpiredSessions).toHaveBeenCalledOnce();
});

it("signs people in with the users, sessions, hasher and a login throttle", async () => {
  await activateApplicationServices(world.database, DATABASE_PATH);

  expect(vi.mocked(AuthService).mock.calls[0]).toEqual([
    only(vi.mocked(UserService)),
    only(vi.mocked(SessionService)),
    only(vi.mocked(PasswordHasher)),
    only(vi.mocked(LoginThrottle)),
  ]);
});

it("publishes agent ticket changes to GitHub through their own ticket repository", async () => {
  await activateApplicationServices(world.database, DATABASE_PATH);

  const [, publisherTasks] = vi.mocked(TaskRepository).mock.instances;
  expect(vi.mocked(TaskRepository).mock.calls).toEqual([
    [world.database],
    [world.database],
  ]);
  expect(vi.mocked(TaskHistoryRecorder).mock.calls).toEqual([[publisherTasks]]);
  expect(vi.mocked(TaskGitHubPublisher).mock.calls[0]).toEqual([
    publisherTasks,
    only(vi.mocked(TaskHistoryRecorder)),
    only(vi.mocked(ServerCache)),
  ]);
  expect(TaskGitHubPublisher.prototype.attach).toHaveBeenCalledWith(
    only(vi.mocked(GitHubSyncService)),
  );
});

it("gives agents and the chat the shared accounts, wiki, plans and events", async () => {
  await activateApplicationServices(world.database, DATABASE_PATH);

  const accounts = {
    users: only(vi.mocked(UserService)),
    administration: only(vi.mocked(AdministrationService)),
  };
  expect(createMcpServices).toHaveBeenCalledWith(
    world.database,
    accounts.users,
    accounts.administration,
    {
      directory: "/srv/pages/data",
      wikiService: only(vi.mocked(WikiService)),
      tickets: {
        cache: only(vi.mocked(ServerCache)),
        publisher: only(vi.mocked(TaskGitHubPublisher)),
      },
      agentWorkspaces: world.agents.agentWorkspaceService,
      pageAgents: world.agents.pageAgentService,
      plans: world.plans.agentPlanService,
      planRecovery: world.plans.agentPlanRecoveryService,
      events: only(vi.mocked(PagesEventPublisher)),
    },
  );
  expect(createChatServices).toHaveBeenCalledWith({
    database: world.database,
    directory: "/srv/pages/data",
    accounts,
    agents: { ...world.agents, ...world.plans },
    router: world.mcp.chatOperationRouter,
    acp: {
      bridgeUrl: "http://127.0.0.1:3100/api/v1/pica-bridge",
      workspaceRoot: "/srv/pages/pica-sessions",
    },
    protectedOrigin: undefined,
  });
});
