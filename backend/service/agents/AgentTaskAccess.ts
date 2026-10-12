import { agentChannelPolicy } from "@/backend/auth/McpActorContext";
import { PermissionService } from "@/backend/auth/PermissionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { ProjectService } from "@/backend/service/ProjectService";
import { TaskService } from "@/backend/service/TaskService";
import { ProjectAccessService } from "@/backend/service/project/ProjectAccessService";

import type {
  ActorChannel,
  AgentChannel,
} from "@/backend/auth/McpActorContext";
import type { AuthorizationFacts } from "@/backend/service/project/ProjectAccessService";
import type { TaskDatabase } from "@/backend/database/repositories/task/TaskDatabase";
import type { Project } from "@/definition/Project";
import type { WorkItemVisibility } from "@/definition/Task";
import type { User } from "@/definition/User";

/**
 * Project access for an agent call.
 *
 * @remarks
 * Every decision the ticket services take about projects goes through the
 * channel of the agent: on the `mcp` channel a personal administrator counts
 * as one regardless of the role mode of the browser, exactly like in the wiki
 * reads and writes; the chat agent keeps the persisted role mode of the UI.
 */
class AgentProjectAccess extends ProjectService {
  private readonly agentAccess: ProjectAccessService;

  public constructor(
    repository: ProjectRepository,
    permissions: PermissionService,
    channel: ActorChannel,
  ) {
    super(repository, permissions);
    this.agentAccess = new ProjectAccessService(
      repository,
      ServerCache.disabled(),
      channel,
    );
  }

  /** Decides through the channel of the agent. */
  public override async findAll(actor: User): Promise<Project[]> {
    return this.agentAccess.findAll(actor);
  }

  /** Decides through the channel of the agent. */
  public override async getById(
    actor: User,
    projectId: string,
  ): Promise<Project> {
    return this.agentAccess.getById(actor, projectId);
  }

  /** Decides through the channel of the agent. */
  public override async workItemVisibility(
    actor: User,
  ): Promise<WorkItemVisibility> {
    return (await this.agentAccess.scope(actor)).visibility;
  }

  /** Decides through the channel of the agent. */
  public override async authorizationFacts(
    actor: User,
  ): Promise<AuthorizationFacts> {
    return this.agentAccess.authorizationFacts(actor);
  }

  /** Decides through the channel of the agent. */
  public override async filterAssignees(
    candidates: ReadonlyMap<string, readonly User[]>,
  ): Promise<ReadonlyMap<string, readonly User[]>> {
    return this.agentAccess.filterAssignees(candidates);
  }

  /** Decides through the channel of the agent. */
  public override async canWriteProject(
    actor: User,
    projectId: string,
  ): Promise<boolean> {
    return this.agentAccess.canWrite(actor, projectId);
  }
}

/** The services one agent call uses, all bound to the same database scope. */
export interface AgentTaskContext {
  readonly actor: User;
  /** The agent surface the call runs for; decides policy and activity marker. */
  readonly channel: AgentChannel;
  readonly database: TaskDatabase;
  readonly tasks: TaskService;
  readonly projects: ProjectService;
  readonly permissions: PermissionService;
}

/**
 * Creates the ticket services for one agent call, bound to the given database scope.
 *
 * @param database - The central database, or the scope of the transaction the call runs in.
 * @param actor - The verified account the call acts for.
 * @param channel - The agent surface the call runs for.
 * @returns Ticket and project services with fresh channel policy and no GitHub synchronization attached.
 *
 * @remarks
 * Publishing to GitHub is left to the caller, which does it after the commit
 * with the shared publisher. The cache is disabled because the caller
 * invalidates the shared one once the transaction has committed.
 */
export function createAgentTaskContext(
  database: TaskDatabase,
  actor: User,
  channel: AgentChannel = "mcp",
): AgentTaskContext {
  const policy = agentChannelPolicy(channel);
  const projects = new ProjectRepository(database, policy.source);
  const access = new ProjectAccessService(
    projects,
    ServerCache.disabled(),
    policy.actor,
  );
  const permissions = new PermissionService((id) =>
    access.account({ ...actor, id }),
  );

  const projectAccess = new AgentProjectAccess(
    projects,
    permissions,
    policy.actor,
  );

  return {
    actor,
    channel,
    database,
    permissions,
    projects: projectAccess,
    tasks: new TaskService(
      new TaskRepository(database),
      projectAccess,
      permissions,
      ServerCache.disabled(),
    ),
  };
}
