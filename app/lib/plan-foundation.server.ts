import path from "node:path";

import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { PermissionService } from "@/backend/auth/PermissionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { AdministrationService } from "@/backend/service/AdministrationService";
import { ProjectService } from "@/backend/service/ProjectService";
import { AnnouncingTaskService } from "@/backend/service/AnnouncingTaskService";
import { UserService } from "@/backend/service/UserService";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import { AnnouncingWikiService } from "@/backend/service/wiki/AnnouncingWikiService";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";
import { WorkItemAttachmentRepository } from "@/backend/database/repositories/task/WorkItemAttachmentRepository";
import { TaskAttachmentService } from "@/backend/service/task/TaskAttachmentService";
import { TicketFileStore } from "@/backend/storage/TicketFileStore";
import { AgentAssetRepository } from "@/backend/database/repositories/agents/AgentAssetRepository";
import { AgentAssetService } from "@/backend/service/agents/AgentAssetService";
import { AgentPlanAssetRepository } from "@/backend/database/repositories/agents/AgentPlanAssetRepository";
import { AgentContentAccess } from "@/backend/service/agents/AgentContentAccess";
import { PlanAssetService } from "@/backend/service/agents/assets/PlanAssetService";

import type { Database } from "@/backend/database/Database";
import type { AgentTicketAssetDependencies } from "@/backend/service/agents/AgentTicketAssetService";

/** Authorization and content readers used by plans; no application schedulers or HTTP services. */
export interface PlanFoundation {
  readonly users: UserService;
  readonly tasks: AnnouncingTaskService;
  readonly projects: ProjectService;
  readonly events: PagesEventPublisher;
  readonly ticketAssets: AgentTicketAssetDependencies;
}

/** Shares the normal authorization and content services without starting application maintenance. */
export function createPlanFoundation(input: {
  readonly database: Database;
  readonly databasePath: string;
  readonly tokenKey: Buffer;
}): PlanFoundation {
  const { database, databasePath, tokenKey } = input;
  const directory = path.dirname(databasePath);
  const cache = ServerCache.disabled();
  const authorization = new AuthorizationRepository(database);
  const administration = new AdministrationService(
    authorization,
    cache,
    new PasswordHasher(),
  );
  const permissions = new PermissionService((id) =>
    administration.getContext(id),
  );
  const projects = new ProjectRepository(database);
  const projectService = new ProjectService(
    projects,
    permissions,
    tokenKey,
    cache,
  );
  const events = new PagesEventPublisher(database);
  const tasks = new AnnouncingTaskService(
    {
      cache,
      permissionService: permissions,
      projectService,
      taskRepository: new TaskRepository(database),
    },
    events,
  );
  const wiki = new AnnouncingWikiService(
    new WikiRepository(database),
    {
      projectService,
      permissionService: permissions,
    },
    new WikiFileStore(path.join(directory, "wiki-attachments")),
    events,
  );
  return {
    users: new UserService(
      new UserRepository(database),
      permissions,
      administration,
    ),
    tasks,
    projects: projectService,
    events,
    ticketAssets: createPlanTicketAssets({
      database,
      directory,
      tasks,
      wiki,
      authorization,
      projects,
    }),
  };
}

function createPlanTicketAssets(input: {
  readonly database: Database;
  readonly directory: string;
  readonly tasks: AnnouncingTaskService;
  readonly wiki: AnnouncingWikiService;
  readonly authorization: AuthorizationRepository;
  readonly projects: ProjectRepository;
}): AgentTicketAssetDependencies {
  const { database, directory, tasks, wiki, authorization, projects } = input;
  const plans = new PlanAssetService({
    repository: new AgentPlanAssetRepository(database),
    files: new WikiFileStore(path.join(directory, "plan-assets")),
    authorization,
    content: new AgentContentAccess(projects, new WikiRepository(database)),
  });
  return {
    tickets: new TaskAttachmentService(
      new WorkItemAttachmentRepository(database),
      tasks,
      wiki,
      new TicketFileStore(directory),
    ),
    wiki,
    assets: new AgentAssetService({
      repository: new AgentAssetRepository(database),
      files: new WikiFileStore(path.join(directory, "agent-assets")),
      wiki,
    }),
    plans,
  };
}
