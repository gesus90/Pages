import { AgentProfileError } from "@/backend/error/AgentProfileError";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { agentTransactionScope } from "@/backend/service/agents/AgentTransactionScope";
import { AGENT_PROFILE_LIMITS } from "@/definition/AgentProfileRead";

import { AgentProfileAccess } from "./AgentProfileAccess";
import { readableDocument, summarizeInstructions } from "./AgentProfileText";

import type { ActorChannel } from "@/backend/auth/McpActorContext";
import type { Database } from "@/backend/database/Database";
import type { AuthorizationSnapshot } from "@/backend/database/repositories/AuthorizationRepository";
import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { AccountAccess, Department } from "@/definition/Authorization";
import type {
  AgentProfileDetail,
  AgentProfileGroup,
  AgentProfileList,
  AgentProfileListItem,
  AgentProfileModel,
  AgentProfileProject,
  AgentProfileQuery,
  AgentProfileReference,
  AgentProfileRunningStep,
} from "@/definition/AgentProfileRead";
import type { User } from "@/definition/User";
import type { UserGroup } from "@/definition/UserGroup";
import type { AgentEmployeeModels } from "../AgentEmployeeModels";

/** What the profile reads are built from. */
export interface AgentProfileReadDependencies {
  readonly database: Pick<Database, "readTransaction">;
  readonly models: Pick<AgentEmployeeModels, "describe">;
}

/** Everything one read of the profiles works on, read in one transaction. */
interface ProfileContext {
  readonly repository: AuthorizationRepository;
  readonly snapshot: AuthorizationSnapshot;
  readonly users: readonly User[];
  readonly employees: readonly StoredAgentEmployee[];
  readonly titles: ReadonlyMap<string, string | null>;
  readonly groups: readonly UserGroup[];
  readonly projects: ReadonlyMap<string, readonly AgentProfileProject[]>;
  readonly access: AgentProfileAccess;
}

/** A group or department reference of an account. */
function departmentsOf(
  snapshot: AuthorizationSnapshot,
  account: AccountAccess,
): AgentProfileReference[] {
  return snapshot.departments
    .filter((department: Department) =>
      account.departments.includes(department.id),
    )
    .map((department) => ({ id: department.id, name: department.name }));
}

function groupsOf(
  groups: readonly UserGroup[],
  userId: string,
): AgentProfileReference[] {
  return groups
    .filter((group) => group.memberIds.includes(userId))
    .map((group) => ({ id: group.id, name: group.name }));
}

/** Reads a cursor, the position of the next page. */
function readOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!/^\d{1,9}$/u.test(cursor))
    throw new AgentProfileError("invalid_request", "cursor");
  return Number(cursor);
}

/** Reads a page size within the limits of the interface. */
function readLimit(limit: number | undefined): number {
  const size = limit ?? AGENT_PROFILE_LIMITS.defaultLimit;
  if (
    !Number.isInteger(size) ||
    size < 1 ||
    size > AGENT_PROFILE_LIMITS.maximumLimit
  )
    throw new AgentProfileError("invalid_request", "limit");
  return size;
}

/**
 * Reads agent profiles for administrators, group leaders and project
 * managers (PAGE-308).
 *
 * @remarks
 * The oldest rule of the interface holds here: the same decision for every
 * caller. The user interface and the MCP routes read through this class, on
 * the stored memberships of the moment, so both show the same agents with
 * the same fields. It never reads `MEMORY.md`, `DREAM.md`, the archive, chat
 * contents or credentials.
 */
export class AgentProfileReadService {
  private readonly dependencies: AgentProfileReadDependencies;
  private readonly channel: ActorChannel;

  /**
   * Creates the service.
   *
   * @param dependencies - The database and the model descriptions.
   * @param channel - How the administrator role counts: `ui` needs the admin mode, `mcp` the personal eligibility.
   */
  public constructor(
    dependencies: AgentProfileReadDependencies,
    channel: ActorChannel = "ui",
  ) {
    this.dependencies = dependencies;
    this.channel = channel;
  }

  /** The same service for another channel. */
  public forChannel(channel: ActorChannel): AgentProfileReadService {
    return new AgentProfileReadService(this.dependencies, channel);
  }

  /**
   * Lists the agents the reader may read, by name.
   *
   * @param readerId - The account that reads.
   * @param query - The filters and the page.
   * @throws {AgentProfileError} `invalid_request` for a bad cursor or limit.
   */
  public async list(
    readerId: string,
    query: AgentProfileQuery,
  ): Promise<AgentProfileList> {
    const offset = readOffset(query.cursor);
    const limit = readLimit(query.limit);
    return this.run(readerId, async (context) => {
      const matching = this.readable(context)
        .filter((agent) => this.matches(context, agent, query))
        .sort(
          (left, right) =>
            left.displayName.localeCompare(right.displayName) ||
            left.id.localeCompare(right.id),
        );
      const page = matching.slice(offset, offset + limit);
      const loads = await this.loads(context);
      const agents = await Promise.all(
        page.map((agent) => this.listItem(context, agent, loads)),
      );
      return {
        agents,
        total: matching.length,
        nextCursor:
          offset + limit < matching.length ? String(offset + limit) : null,
      };
    });
  }

  /**
   * Reads one agent with every field the reader may see.
   *
   * @param readerId - The account that reads.
   * @param agentId - The agent.
   * @throws {AgentProfileError} `not_found` for an unknown agent, `forbidden`
   * for an agent whose profile the reader may not read.
   */
  public async read(
    readerId: string,
    agentId: string,
  ): Promise<AgentProfileDetail> {
    return this.run(readerId, async (context) => {
      const agent = context.users.find(
        (user) =>
          user.id === agentId &&
          context.employees.some((entry) => entry.userId === user.id),
      );
      if (agent === undefined) throw new AgentProfileError("not_found");
      if (!context.access.canRead(agent.id))
        throw new AgentProfileError("forbidden");
      return this.detail(context, agent);
    });
  }

  /**
   * Reads a group with its leaders and members.
   *
   * @param readerId - The account that reads.
   * @param groupId - The group.
   * @throws {AgentProfileError} `not_found` for an unknown group, `forbidden`
   * for a group the reader neither is a member of nor administers.
   */
  public async group(
    readerId: string,
    groupId: string,
  ): Promise<AgentProfileGroup> {
    return this.run(readerId, async (context) => {
      const group = context.groups.find((entry) => entry.id === groupId);
      if (group === undefined) throw new AgentProfileError("not_found");
      if (
        !context.access.isAdministrator &&
        !group.memberIds.includes(readerId)
      )
        throw new AgentProfileError("forbidden");
      const named = (userId: string): User | undefined =>
        context.users.find((user) => user.id === userId);
      const members = group.memberIds.flatMap((id) => named(id) ?? []);
      return {
        id: group.id,
        name: group.name,
        leaders: members
          .filter((member) => (group.leaderIds ?? []).includes(member.id))
          .map((member) => ({
            id: member.id,
            displayName: member.displayName,
          })),
        members: members.map((member) => ({
          id: member.id,
          displayName: member.displayName,
          isAgent: member.isAgent === true,
        })),
      };
    });
  }

  /**
   * The agents of a group as the overview of the user management shows them.
   *
   * @param readerId - The account that reads.
   * @param groupId - The group.
   * @throws {AgentProfileError} `not_found` for an unknown group, `forbidden`
   * unless the reader administers it or leads it.
   */
  public async groupAgents(
    readerId: string,
    groupId: string,
  ): Promise<AgentProfileList> {
    const group = await this.run(readerId, async (context) => {
      const found = context.groups.find((entry) => entry.id === groupId);
      if (found === undefined) throw new AgentProfileError("not_found");
      if (
        !context.access.isAdministrator &&
        !(found.leaderIds ?? []).includes(readerId)
      )
        throw new AgentProfileError("forbidden");
      return found;
    });
    return this.list(readerId, { groupId: group.id, limit: 100 });
  }

  private async run<Result>(
    readerId: string,
    work: (context: ProfileContext) => Promise<Result>,
  ): Promise<Result> {
    return this.dependencies.database.readTransaction(async (transaction) => {
      const repository = new AuthorizationRepository(
        agentTransactionScope(transaction),
      );
      const store = repository.employees();
      // One transaction runs one statement at a time, so the reads follow each other.
      const snapshot = await repository.snapshot();
      const users = await repository.users().findAll();
      const employees = await store.employees().list();
      const titles = await store.identities().jobTitles();
      const groups = await repository.groups().findAll();
      const projects = await store.profileLoads().projectsByUser();
      const reader = snapshot.accounts.find(
        (account) => account.userId === readerId,
      );
      if (reader === undefined) throw new AgentProfileError("forbidden");
      const access = new AgentProfileAccess(
        {
          reader,
          agentIds: employees.map((employee) => employee.userId),
          groups,
          projectsByUser: projects,
        },
        this.channel,
      );
      return work({
        repository,
        snapshot,
        users,
        employees,
        titles,
        groups,
        projects,
        access,
      });
    });
  }

  /** The agent accounts the reader may read. */
  private readable(context: ProfileContext): User[] {
    return context.users.filter(
      (user) =>
        context.access.canRead(user.id) &&
        context.employees.some((employee) => employee.userId === user.id),
    );
  }

  private matches(
    context: ProfileContext,
    agent: User,
    query: AgentProfileQuery,
  ): boolean {
    const account = context.snapshot.accounts.find(
      (entry) => entry.userId === agent.id,
    );
    return (
      (query.groupId === undefined ||
        groupsOf(context.groups, agent.id).some(
          (group) => group.id === query.groupId,
        )) &&
      (query.departmentId === undefined ||
        account?.departments.includes(query.departmentId) === true) &&
      (query.projectId === undefined ||
        (context.projects.get(agent.id) ?? []).some(
          (project) => project.id === query.projectId,
        ))
    );
  }

  private async loads(context: ProfileContext): Promise<ProfileLoads> {
    const store = context.repository.employees().profileLoads();
    const chats = await store.activeChats();
    const steps = await store.runningSteps();
    const tickets = await store.openTicketCounts();
    const lastActivity = await store.lastActivity();
    return { chats, steps, tickets, lastActivity };
  }

  private async modelOf(
    employee: StoredAgentEmployee,
  ): Promise<AgentProfileModel> {
    const description = await this.dependencies.models.describe(employee);
    return {
      connectionId: employee.connectionId,
      provider: description.provider,
      model: employee.model,
      reasoningEffort: employee.reasoningEffort,
    };
  }

  private async listItem(
    context: ProfileContext,
    agent: User,
    loads: ProfileLoads,
  ): Promise<AgentProfileListItem> {
    const parts = this.parts(context, agent);
    return {
      id: agent.id,
      displayName: agent.displayName,
      isAgent: true,
      role: parts.role,
      summary: summarizeInstructions(parts.employee.instructions),
      departments: parts.departments,
      groups: parts.groups,
      model: await this.modelOf(parts.employee),
      activeChats: loads.chats.get(agent.id) ?? 0,
      runningSteps: (loads.steps.get(agent.id) ?? []).length,
      openTickets: loads.tickets.get(agent.id) ?? 0,
      hiddenFields: context.access.hiddenFields,
    };
  }

  private async detail(
    context: ProfileContext,
    agent: User,
  ): Promise<AgentProfileDetail> {
    const parts = this.parts(context, agent);
    const loads = await this.loads(context);
    const openTickets = await context.repository
      .employees()
      .profileLoads()
      .openTickets(agent.id);
    return {
      id: agent.id,
      displayName: agent.displayName,
      isAgent: true,
      role: parts.role,
      agentMd: readableDocument(parts.employee.instructions),
      soulMd: readableDocument(parts.employee.soul),
      departments: parts.departments,
      groups: parts.groups,
      projects: [...(context.projects.get(agent.id) ?? [])],
      model: await this.modelOf(parts.employee),
      accessLevel: parts.employee.access,
      // Agents have no voice before PAGE-300; the field stays empty until then.
      voice: null,
      load: {
        activeChats: loads.chats.get(agent.id) ?? 0,
        runningSteps: [...(loads.steps.get(agent.id) ?? [])],
        openTickets,
      },
      lastActiveAt: loads.lastActivity.get(agent.id) ?? null,
      hiddenFields: context.access.hiddenFields,
    };
  }

  /** The stored pieces every profile shows. */
  private parts(
    context: ProfileContext,
    agent: User,
  ): {
    readonly employee: StoredAgentEmployee;
    readonly role: string | null;
    readonly departments: AgentProfileReference[];
    readonly groups: AgentProfileReference[];
  } {
    const employee = context.employees.find(
      (entry) => entry.userId === agent.id,
    );
    const account = context.snapshot.accounts.find(
      (entry) => entry.userId === agent.id,
    );
    if (employee === undefined || account === undefined)
      throw new AgentProfileError("not_found");
    return {
      employee,
      role: context.titles.get(agent.id) ?? account.role?.name ?? null,
      departments: departmentsOf(context.snapshot, account),
      groups: groupsOf(context.groups, agent.id),
    };
  }
}

/** The workload of every agent, read once per request. */
interface ProfileLoads {
  readonly chats: ReadonlyMap<string, number>;
  readonly steps: ReadonlyMap<string, readonly AgentProfileRunningStep[]>;
  readonly tickets: ReadonlyMap<string, number>;
  readonly lastActivity: ReadonlyMap<string, string>;
}
