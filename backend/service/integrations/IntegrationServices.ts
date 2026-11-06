import path from "node:path";

import { GitHubCreationRepository } from "@/backend/database/repositories/integrations/GitHubCreationRepository";
import { PermissionService } from "@/backend/auth/PermissionService";
import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { WorkItemAttachmentRepository } from "@/backend/database/repositories/task/WorkItemAttachmentRepository";
import { AgentAssetRepository } from "@/backend/database/repositories/agents/AgentAssetRepository";
import { AdministrationService } from "@/backend/service/AdministrationService";
import { GitHubSyncService } from "@/backend/service/GitHubSyncService";
import { ProjectService } from "@/backend/service/ProjectService";
import { TaskDescriptionAssetService } from "@/backend/service/task/TaskDescriptionAssetService";
import { TaskService } from "@/backend/service/TaskService";
import { TaskAttachmentService } from "@/backend/service/task/TaskAttachmentService";
import { UserService } from "@/backend/service/UserService";
import { WikiService } from "@/backend/service/WikiService";
import { AgentAssetService } from "@/backend/service/agents/AgentAssetService";
import { TicketFileStore } from "@/backend/storage/TicketFileStore";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";

import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import type { Database } from "@/backend/database/Database";

/** Dependencies limited to data access and integration authorization; no application runtime. */
export interface IntegrationServices {
  readonly github: GitHubSyncService;
  readonly tasks: TaskService;
  readonly users: UserService;
  readonly userRepository: UserRepository;
  readonly ticketAssets: {
    readonly tickets: TaskAttachmentService;
    readonly wiki: WikiService;
    readonly assets: AgentAssetService;
  };
}

/**
 * Builds only services needed to execute GitHub jobs and authorize FCM payloads.
 *
 * @param database - The open database.
 * @param directory - Instance data directory.
 * @param tokenKey - Decrypts stored GitHub tokens.
 * @param options - The publisher the GitHub changes store their events with.
 * @returns The services of the integration process.
 */
export function createIntegrationServices(
  database: Database,
  directory: string,
  tokenKey: Buffer,
  options: { readonly events: Pick<PagesEventPublisher, "announce"> },
): IntegrationServices {
  const cache = ServerCache.disabled();
  const administration = new AdministrationService(
    new AuthorizationRepository(database),
    cache,
    new PasswordHasher(),
  );
  const permissions = new PermissionService((id) =>
    administration.getContext(id),
  );
  const userRepository = new UserRepository(database);
  const users = new UserService(userRepository, permissions, administration);
  const projects = new ProjectRepository(database);
  const projectService = new ProjectService(
    projects,
    permissions,
    tokenKey,
    cache,
  );
  const taskRepository = new TaskRepository(database);
  // No attached publisher: worker-owned imports must not recursively queue or start work.
  const tasks = new TaskService(
    taskRepository,
    projectService,
    permissions,
    cache,
  );
  tasks.setDescriptionAssets(
    new TaskDescriptionAssetService(database, directory),
  );
  const wiki = new WikiService(
    new WikiRepository(database),
    projectService,
    permissions,
    new WikiFileStore(path.join(directory, "wiki-attachments")),
  );
  const tickets = new TaskAttachmentService(
    new WorkItemAttachmentRepository(database),
    tasks,
    wiki,
    new TicketFileStore(directory),
  );
  const assets = new AgentAssetService({
    repository: new AgentAssetRepository(database),
    files: new WikiFileStore(path.join(directory, "agent-assets")),
    wiki,
  });
  return {
    github: new GitHubSyncService({
      creations: new GitHubCreationRepository(database),
      taskRepository,
      projectRepository: projects,
      gitHubRepository: new GitHubRepository(database),
      userRepository,
      projectService,
      taskService: tasks,
      tokenKey,
      cache,
      events: options.events,
    }),
    tasks,
    users,
    userRepository,
    ticketAssets: { tickets, wiki, assets },
  };
}
