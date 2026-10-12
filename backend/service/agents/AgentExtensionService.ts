import { agentChannelPolicy } from "@/backend/auth/McpActorContext";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import {
  WikiAccessDeniedError,
  WikiConflictError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import {
  ProjectDepartmentError,
  ProjectManagementDeniedError,
} from "@/backend/error/ProjectErrors";
import { WikiPageReader } from "@/backend/service/wiki/WikiPageReader";
import { WikiTrashService } from "@/backend/service/wiki/WikiTrashService";
import { canManagePage } from "@/backend/service/wiki/WikiAccess";
import { ProjectManagementService } from "@/backend/service/project/ProjectManagementService";
import { ServerCache } from "@/backend/cache/ServerCache";
import {
  AGENT_EXTENSION_READ_OPERATIONS,
  AGENT_EXTENSION_WRITE_OPERATIONS,
} from "@/definition/AgentExtensions";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";

import { translateAgentTicketError } from "./AgentTicketErrors";
import { agentTransactionScope } from "./AgentTransactionScope";
import { createAgentTaskContext } from "./AgentTaskAccess";
import { requireAgentConfirmation } from "./AgentConfirmation";
import { readAgentExtension } from "./AgentExtensionReads";
import { readIdentifier, readParameterRecord } from "./AgentParameterReader";
import { applyAgentPlanningExtension } from "./AgentPlanningExtensions";
import {
  applyAgentMilestoneInitiative,
  applyAgentTicketTags,
} from "./AgentPlanningLinks";
import { applyAgentProject } from "./AgentProjectOperations";
import { AgentTicketTransaction } from "./AgentTicketTransaction";
import { applyAgentWikiAnchors } from "./AgentWikiAnchors";
import { createAgentWikiAccess } from "./AgentWikiAccess";
import {
  normalizeRevision,
  readWikiPageReference,
} from "./AgentWikiFieldValidation";

import type { AgentChannel } from "@/backend/auth/McpActorContext";
import type { Database } from "@/backend/database/Database";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type {
  AgentExtensionChanged,
  AgentExtensionReadOperation,
  AgentExtensionWriteOperation,
} from "@/definition/AgentExtensions";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { AgentTaskContext } from "./AgentTaskAccess";
import type { AgentPlanningReadService } from "./AgentPlanningReadService";
import type { AgentTicketAnnouncer } from "./AgentTicketAnnouncer";

const WRITE_KEYS: Readonly<
  Record<AgentExtensionWriteOperation, readonly string[]>
> = {
  "wiki.page.delete": ["pageId", "expectedRevision", "confirmation"],
  "projects.create": ["name", "description", "status", "departmentIds"],
  "projects.setName": ["projectId", "name"],
  "projects.setDescription": ["projectId", "description"],
  "projects.setStatus": ["projectId", "status"],
  "projects.setDates": ["projectId", "startDate", "targetDate"],
  "projects.member.assign": ["projectId", "targetType", "targetId", "role"],
  "projects.member.remove": ["projectId", "targetType", "targetId"],
  "ticket.setAssignee": [
    "ticketId",
    "targetType",
    "targetId",
    "expectedAssigneeId",
    "expectedAssigneeGroupId",
    "expectedDepartmentId",
  ],
  "ticket.assignMilestone": ["ticketId", "milestoneId", "expectedMilestoneId"],
  "ticket.delete": ["ticketId", "confirmation"],
  "milestone.delete": ["projectId", "milestoneId", "confirmation"],
  "ticket.setTags": ["ticketId", "tagIds", "expectedTagIds"],
  "milestone.initiative.add": ["projectId", "milestoneId", "initiativeId"],
  "milestone.initiative.remove": ["projectId", "milestoneId", "initiativeId"],
  "wiki.page.setAnchors": ["pageId", "anchors", "expectedAnchors"],
};

function translate(error: unknown): unknown {
  if (error instanceof WikiPageNotFoundError)
    return new AgentOperationError("NOT_FOUND");
  if (
    error instanceof WikiAccessDeniedError ||
    error instanceof ProjectManagementDeniedError
  )
    return new AgentOperationError("FORBIDDEN");
  if (
    error instanceof WikiValidationError ||
    error instanceof ProjectDepartmentError
  )
    return new AgentOperationError("INVALID_REQUEST");
  if (error instanceof WikiConflictError)
    return new AgentOperationError("CONFLICT");
  return translateAgentTicketError(error);
}

/** Server-owned dispatcher for the A11.1 operations; the adapter never supplies policy. */
export class AgentExtensionService {
  private readonly database: Database;
  private readonly cache: ServerCache;
  private readonly planning: AgentPlanningReadService;
  private readonly announcer: AgentTicketAnnouncer;
  private readonly transaction: AgentTicketTransaction;
  private readonly channel: AgentChannel;

  public constructor(dependencies: {
    readonly database: Database;
    readonly planning: AgentPlanningReadService;
    readonly announcer: AgentTicketAnnouncer;
    readonly cache: ServerCache;
    /** The agent surface the operations run for; MCP when absent. */
    readonly channel?: AgentChannel;
  }) {
    this.database = dependencies.database;
    this.cache = dependencies.cache;
    this.planning = dependencies.planning;
    this.announcer = dependencies.announcer;
    this.channel = dependencies.channel ?? "mcp";
    this.transaction = new AgentTicketTransaction(
      dependencies.database,
      this.channel,
    );
  }

  /** Handles an extension, returning null when another existing operation owns the name. */
  public async handle(
    identity: AgentIdentity,
    operation: unknown,
    input: unknown,
  ): Promise<PagesAgentReadResponse | PagesAgentWriteResponse | null> {
    const read = AGENT_EXTENSION_READ_OPERATIONS.find(
      (name) => name === operation,
    );
    const write = AGENT_EXTENSION_WRITE_OPERATIONS.find(
      (name) => name === operation,
    );
    const readCommand = read && { kind: "read" as const, operation: read };
    const command =
      readCommand ?? (write && { kind: "write" as const, operation: write });
    if (!command) return null;
    const parameters = normalizeRevision(readParameterRecord(input ?? {}));
    try {
      if (command.kind === "read")
        return await this.read(identity, command.operation, parameters);
      return await this.write(identity, command.operation, parameters);
    } catch (error: unknown) {
      throw translate(error);
    }
  }

  private async read(
    identity: AgentIdentity,
    operation: AgentExtensionReadOperation,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<PagesAgentReadResponse> {
    const selector = operation.startsWith("wiki.") ? "pageId" : "projectId";
    const keys = [
      "cursor",
      "limit",
      ...(operation.endsWith(".list") && !operation.startsWith("projects.")
        ? []
        : [selector]),
    ];
    if (Object.keys(parameters).some((key) => !keys.includes(key)))
      throw new AgentOperationError("INVALID_REQUEST");
    if (operation === "projects.tickets.list")
      return this.planning.readProjectTickets(identity, parameters);
    const result = await this.database.transaction(async (transaction) => {
      const scope = agentTransactionScope(transaction);
      const actor = await new UserRepository(scope).findById(identity.userId);
      if (!actor?.isActive || actor.mustChangePassword)
        throw new McpAuthorizationError("invalid_token", 401);
      return readAgentExtension(
        createAgentTaskContext(scope, actor, this.channel),
        operation,
        parameters,
      );
    });
    const response: PagesAgentReadResponse = { apiVersion: "1", result };
    if (
      Buffer.byteLength(JSON.stringify(response)) >
      PAGES_AGENT_LIMITS.responseBytes
    )
      throw new AgentOperationError("PAYLOAD_TOO_LARGE");
    return response;
  }

  private async write(
    identity: AgentIdentity,
    operation: AgentExtensionWriteOperation,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<PagesAgentWriteResponse> {
    const keys = ["operationId", ...WRITE_KEYS[operation]];
    if (
      Object.keys(parameters).some((key) => !keys.includes(key)) ||
      keys
        .filter(
          (key) => key !== "confirmation" && key !== "expectedDepartmentId",
        )
        .some((key) => !(key in parameters))
    )
      throw new AgentOperationError("INVALID_REQUEST");
    const request = {
      ...parameters,
      operationId: readIdentifier(parameters.operationId),
    };
    const completed = await this.transaction.run<AgentExtensionChanged>({
      userId: identity.userId,
      operation,
      request,
      needsWriteRight:
        operation.startsWith("ticket.") ||
        operation.startsWith("milestone.initiative."),
      revisit: async (context, stored) => {
        if (operation.endsWith(".delete"))
          await requireAgentConfirmation(
            context.database,
            context.actor.id,
            parameters.confirmation,
          );
        if (stored.projectId !== null)
          await context.projects.getById(context.actor, stored.projectId);
        if (
          operation.startsWith("projects.") ||
          operation === "milestone.delete"
        )
          await this.authorizeProjectReplay(
            context,
            operation,
            stored,
            parameters,
          );
        if (operation.startsWith("ticket."))
          await context.tasks.getById(context.actor, stored.id);
        if (
          operation.startsWith("milestone.initiative.") &&
          stored.relatedId !== undefined
        )
          await context.tasks.getById(context.actor, stored.relatedId);
        if (
          operation === "wiki.page.delete" ||
          operation === "wiki.page.setAnchors"
        ) {
          const wiki = new WikiRepository(
            context.database,
            agentChannelPolicy(context.channel).source,
          );
          const viewer = await createAgentWikiAccess(
            new ProjectRepository(context.database),
            context.actor,
            context.channel,
          ).resolve(context.actor);
          const page = await wiki.pages.findVisible(viewer.scope, stored.id, {
            includeDeleted: operation === "wiki.page.delete",
          });
          if (!page) throw new AgentOperationError("NOT_FOUND");
          if (!canManagePage(viewer, page))
            throw new AgentOperationError("FORBIDDEN");
        }
      },
      work: async (context) => {
        const result = await this.apply(context, operation, parameters);
        const published =
          operation === "ticket.setAssignee" ||
          operation === "ticket.assignMilestone"
            ? await context.tasks.getById(context.actor, result.id)
            : null;
        const event = result.changed
          ? extensionEvent(operation, result.id)
          : null;
        return { result, published, event };
      },
    });
    this.announcer.announce(completed);
    if (completed.event !== null || operation.startsWith("projects.")) {
      this.cache.invalidateProjectMembership();
      this.cache.invalidateWorkItems();
      if (completed.result.projectId !== null)
        this.cache.invalidateProject(completed.result.projectId);
    }
    return { apiVersion: "1", result: completed.result };
  }

  private async apply(
    context: AgentTaskContext,
    operation: AgentExtensionWriteOperation,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<AgentExtensionChanged> {
    if (operation.startsWith("projects."))
      return applyAgentProject(context, operation, parameters);
    if (operation === "wiki.page.delete")
      return this.deleteWiki(context, parameters);
    if (operation === "wiki.page.setAnchors")
      return applyAgentWikiAnchors(context, parameters);
    if (operation === "ticket.setTags")
      return applyAgentTicketTags(context, parameters);
    if (
      operation === "milestone.initiative.add" ||
      operation === "milestone.initiative.remove"
    )
      return applyAgentMilestoneInitiative(context, operation, parameters);
    return applyAgentPlanningExtension(context, operation, parameters);
  }

  private async authorizeProjectReplay(
    context: AgentTaskContext,
    operation: AgentExtensionWriteOperation,
    stored: AgentExtensionChanged,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const projectId = stored.projectId ?? stored.id;
    if (
      operation.startsWith("projects.member.") &&
      parameters.targetType === "department"
    ) {
      const policy = agentChannelPolicy(context.channel);
      const permissions = await new ProjectManagementService(
        new ProjectRepository(context.database, policy.source),
        ServerCache.disabled(),
        policy.actor,
      ).permissions(context.actor, projectId);
      if (!permissions.canChangeDepartments)
        throw new AgentOperationError("FORBIDDEN");
      return;
    }
    if (!(await context.projects.canWriteProject(context.actor, projectId)))
      throw new AgentOperationError("FORBIDDEN");
  }

  private async deleteWiki(
    context: AgentTaskContext,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<AgentExtensionChanged> {
    if (
      !Number.isSafeInteger(parameters.expectedRevision) ||
      typeof parameters.expectedRevision !== "number" ||
      parameters.expectedRevision < 1
    )
      throw new AgentOperationError("INVALID_REQUEST");
    await requireAgentConfirmation(
      context.database,
      context.actor.id,
      parameters.confirmation,
    );
    const wiki = new WikiRepository(
      context.database,
      agentChannelPolicy(context.channel).source,
    );
    const access = createAgentWikiAccess(
      new ProjectRepository(context.database),
      context.actor,
      context.channel,
    );
    const viewer = await access.resolve(context.actor);
    const page = await new WikiPageReader(wiki).require(
      viewer.scope,
      readWikiPageReference(parameters.pageId),
    );
    if (page.revision !== parameters.expectedRevision)
      throw new AgentOperationError("CONFLICT", {
        currentRevision: page.revision,
      });
    const ids = await wiki.pages.findSubtreeIds(page.id);
    await new WikiTrashService(wiki, access).delete(context.actor, page.id);
    return {
      id: page.id,
      projectId: page.projectId,
      changed: true,
      affectedCount: ids.length,
      recursive: true,
      disposition: "trash",
    };
  }
}

function extensionEvent(
  operation: AgentExtensionWriteOperation,
  id: string,
): PagesEvent | null {
  if (operation.startsWith("ticket.")) return { type: "ticket.updated", id };
  if (
    operation === "milestone.delete" ||
    operation.startsWith("milestone.initiative.")
  )
    return { type: "milestone.updated", id };
  if (operation === "wiki.page.delete" || operation === "wiki.page.setAnchors")
    return { type: "wiki.page.updated", id };
  return null;
}
