import { agentChannelPolicy } from "@/backend/auth/McpActorContext";
import { PermissionService } from "@/backend/auth/PermissionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { ProjectAccessService } from "@/backend/service/project/ProjectAccessService";
import { WikiAccess } from "@/backend/service/wiki/WikiAccess";
import { WikiReadService } from "@/backend/service/wiki/WikiReadService";
import { WikiSearchService } from "@/backend/service/wiki/WikiSearchService";
import { WikiTrashService } from "@/backend/service/wiki/WikiTrashService";
import {
  PAGES_AGENT_LIMITS,
  PAGES_AGENT_READ_OPERATIONS,
} from "@/definition/PagesAgentOperations";

import { AgentProjectReadService } from "./AgentProjectReadService";
import { AgentWikiReadService } from "./AgentWikiReadService";
import { createAgentWikiAccess } from "./AgentWikiAccess";
import { dispatchAgentTicketNavigation } from "./AgentTicketNavigationDispatch";
import {
  isAgentTicketLinkOperation,
  isAgentTicketNavigationRead,
} from "./AgentTicketNavigationValidation";
import {
  isAgentMilestoneOperation,
  isAgentTicketOperation,
} from "./AgentTicketValidation";
import { isAgentCommentOperation } from "./AgentWikiCommentValidation";
import {
  isAgentWikiPageOperation,
  readAgentWikiPageRange,
} from "./AgentWikiFieldValidation";
import { WikiImportPlanner } from "./WikiImportPlanner";

import type { AgentChannel } from "@/backend/auth/McpActorContext";
import type { AgentAdministrationService } from "./AgentAdministrationService";
import type { AgentAdminWriteResponse } from "@/definition/AgentAdministration";
import type { AgentExtensionService } from "./AgentExtensionService";
import type { AgentProjectDeletionService } from "./AgentProjectDeletionService";
import type { AgentPlanningServices } from "./AgentPlanningServices";
import type { AgentWikiCommentService } from "./AgentWikiCommentService";
import type { AgentWikiFieldService } from "./AgentWikiFieldService";
import type { AgentWorkspaceOperationService } from "./AgentWorkspaceOperationService";
import type { AgentPlanOperationService } from "./AgentPlanOperationService";
import type { PageAgentOperationService } from "./PageAgentOperationService";
import type { AgentWriteOperationService } from "./AgentWriteOperationService";
import type { StructuredImportService } from "./StructuredImportService";
import type { WikiImportService } from "./WikiImportService";
import type { WikiImportUpdateService } from "./WikiImportUpdateService";
import type { AgentWikiPageOperation } from "@/definition/AgentWikiFields";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { UserService } from "@/backend/service/UserService";
import type { User } from "@/definition/User";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type {
  PagesAgentCommentOperation,
  PagesAgentReadOperation,
  PagesAgentReadResponse,
  PagesAgentStructuredReadResponse,
} from "@/definition/PagesAgentOperations";

/** Server-owned dependencies; no actor or policy arrives through operation parameters. */
export interface AgentOperationDependencies {
  readonly projects: ProjectRepository;
  readonly wiki: WikiRepository;
  readonly users: Pick<UserService, "getById">;
  readonly writes?: AgentWriteOperationService;
  readonly imports?: WikiImportService;
  readonly importUpdates?: WikiImportUpdateService;
  readonly structured?: StructuredImportService;
  readonly fields?: AgentWikiFieldService;
  readonly comments?: AgentWikiCommentService;
  readonly planning?: AgentPlanningServices;
  readonly extensions?: AgentExtensionService;
  readonly administration?: AgentAdministrationService;
  /** Permanent project deletion; wired for MCP only, never for the chat. */
  readonly projectDeletion?: AgentProjectDeletionService;
  readonly workspaces?: AgentWorkspaceOperationService;
  /** Agent plans and their runs, offered to MCP clients and the chat alike. */
  readonly plans?: Pick<AgentPlanOperationService, "handle">;
  readonly pageAgents?: Pick<PageAgentOperationService, "handle">;
  /** The agent surface the reads run for; MCP when absent. */
  readonly channel?: AgentChannel;
}

function readParameters(input: unknown): Readonly<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AgentOperationError("INVALID_REQUEST");
  return input as Record<string, unknown>;
}

function readText(
  parameters: Readonly<Record<string, unknown>>,
  name: string,
): string {
  const text = parameters[name];
  if (
    typeof text !== "string" ||
    !text.trim() ||
    Array.from(text).length > PAGES_AGENT_LIMITS.textCharacters
  )
    throw new AgentOperationError("INVALID_REQUEST");
  return text.trim();
}

function validateParameters(
  operation: Exclude<PagesAgentReadOperation, "wiki.import.plan">,
  parameters: Readonly<Record<string, unknown>>,
): void {
  const allowed = {
    "projects.resolve": ["name"],
    "projects.read": ["projectId"],
    "wiki.page.read": ["pageId"],
    "wiki.tree.read": ["projectId", "cursor", "limit"],
    "wiki.search": ["text", "projectId", "cursor", "limit"],
  }[operation];
  if (Object.keys(parameters).some((key) => !allowed.includes(key)))
    throw new AgentOperationError("INVALID_REQUEST");
}

/** Dispatches reads, import previews and writes using fresh authentication and isolated MCP policy. */
export class AgentOperationRouter {
  private readonly dependencies: AgentOperationDependencies;
  private readonly channel: AgentChannel;

  public constructor(dependencies: AgentOperationDependencies) {
    this.dependencies = dependencies;
    this.channel = dependencies.channel ?? "mcp";
  }

  /** Issues a binary upload capability through the authenticated API boundary. */
  public async prepareUpload(
    identity: AgentIdentity,
    token: string,
    parameters: unknown,
  ): Promise<PagesAgentWriteResponse> {
    if (!this.dependencies.writes)
      throw new AgentOperationError("INVALID_REQUEST");
    return this.dependencies.writes.prepare(identity, token, parameters);
  }

  /** Resolves current persisted scope for each call and returns a bounded version-1 result. */
  public async handle(
    identity: AgentIdentity,
    input: Readonly<Record<string, unknown>>,
    verify?: () => Promise<AgentIdentity>,
  ): Promise<
    | PagesAgentReadResponse
    | PagesAgentStructuredReadResponse
    | PagesAgentWriteResponse
    | AgentAdminWriteResponse
  > {
    const extension = await this.handleAdditional(identity, input);
    if (extension) return extension;
    const direct = await this.handleDirect(identity, input, verify);
    if (direct) return direct;
    const operation = PAGES_AGENT_READ_OPERATIONS.find(
      (name) => name === input.operation,
    );
    if (!operation) throw new AgentOperationError("INVALID_REQUEST");
    if (operation === "wiki.import.plan")
      return this.planImport(identity, input.parameters);
    const parameters = readParameters(
      input.parameters === undefined ? {} : input.parameters,
    );
    validateParameters(operation, parameters);
    const actor = await this.requireActor(identity);
    const access = this.projectAccess();
    const projects = new AgentProjectReadService(access);
    const wiki = this.wikiReads(actor, access);
    let result: PagesAgentReadResponse["result"];
    if (operation === "projects.resolve")
      result = await projects.resolve(actor, readText(parameters, "name"));
    else if (operation === "projects.read")
      result = await projects.read(actor, readText(parameters, "projectId"));
    else if (operation === "wiki.page.read")
      result = await wiki.read(actor, readText(parameters, "pageId"));
    else {
      const projectId =
        parameters.projectId === undefined
          ? undefined
          : readText(parameters, "projectId");
      if (projectId !== undefined) await projects.read(actor, projectId);
      const paging = {
        cursor: parameters.cursor,
        limit: parameters.limit,
        context: JSON.stringify([
          actor.id,
          operation,
          projectId,
          parameters.text,
        ]),
      };
      result =
        operation === "wiki.tree.read"
          ? await wiki.tree(actor, projectId, paging)
          : await wiki.search(
              actor,
              readText(parameters, "text"),
              projectId,
              paging,
            );
    }
    const response: PagesAgentReadResponse = { apiVersion: "1", result };
    if (
      Buffer.byteLength(JSON.stringify(response)) >
      (operation === "wiki.page.read"
        ? PAGES_AGENT_LIMITS.wikiEnvelopeBytes
        : PAGES_AGENT_LIMITS.responseBytes)
    )
      throw new AgentOperationError("PAYLOAD_TOO_LARGE");
    return response;
  }

  private projectAccess(): ProjectAccessService {
    return new ProjectAccessService(
      this.dependencies.projects,
      ServerCache.disabled(),
      agentChannelPolicy(this.channel).actor,
    );
  }

  private wikiReads(
    actor: User,
    access: ProjectAccessService,
  ): AgentWikiReadService {
    const wikiAccess = new WikiAccess(
      {
        workItemVisibility: async (user) =>
          (await access.scope(user)).visibility,
      },
      new PermissionService((id) => access.account({ ...actor, id })),
    );
    const reads = new WikiReadService(
      this.dependencies.wiki,
      wikiAccess,
      new WikiTrashService(this.dependencies.wiki, wikiAccess),
    );
    return new AgentWikiReadService(
      reads,
      new WikiSearchService(this.dependencies.wiki, wikiAccess),
      this.dependencies.wiki.anchors,
    );
  }

  private async handleAdditional(
    identity: AgentIdentity,
    input: Readonly<Record<string, unknown>>,
  ): Promise<
    | PagesAgentReadResponse
    | PagesAgentWriteResponse
    | AgentAdminWriteResponse
    | null
  > {
    const administration = await this.dependencies.administration?.handle(
      identity,
      input.operation,
      input.parameters,
    );
    if (administration) return administration;
    const deletion = await this.dependencies.projectDeletion?.handle(
      identity,
      input.operation,
      input.parameters,
    );
    if (deletion) return deletion;
    const extension = await this.dependencies.extensions?.handle(
      identity,
      input.operation,
      input.parameters,
    );
    if (extension) return extension;
    const workspace = await this.dependencies.workspaces?.handle(
      identity,
      input.operation,
      input.parameters,
    );
    if (workspace) return workspace;
    const plan = await this.dependencies.plans?.handle(
      identity,
      input.operation,
      input.parameters,
    );
    if (plan) return plan;
    return (
      (await this.dependencies.pageAgents?.handle(
        identity,
        input.operation,
        input.parameters,
      )) ?? null
    );
  }

  /** Runs a write, or a ticket or milestone read, or returns `null` when the name is none of them. */
  private async handleDirect(
    identity: AgentIdentity,
    input: Readonly<Record<string, unknown>>,
    verify: (() => Promise<AgentIdentity>) | undefined,
  ): Promise<
    | PagesAgentReadResponse
    | PagesAgentStructuredReadResponse
    | PagesAgentWriteResponse
    | null
  > {
    const range = await this.handleTextRange(identity, input);
    if (range) return range;
    const checklist = await this.handleChecklist(identity, input);
    if (checklist) return checklist;
    const planned = await this.handlePlanning(identity, input);
    if (planned) return planned;
    if (isAgentCommentOperation(input.operation))
      return this.handleComment(identity, input.operation, input.parameters);
    if (
      input.operation === "import.structured.plan" ||
      input.operation === "import.structured.apply"
    )
      return this.structuredImport(identity, input, verify);
    if (input.operation === "wiki.import.apply")
      return this.applyImport(identity, input.parameters, verify);
    if (input.operation === "wiki.import.update")
      return this.updateImport(identity, input.parameters, verify);
    if (input.operation === "wiki.page.create" && this.dependencies.writes)
      return this.dependencies.writes.create(identity, input.parameters);
    if (isAgentWikiPageOperation(input.operation))
      return this.changePage(identity, input.operation, input.parameters);
    return null;
  }

  /** Runs a ticket or milestone operation, or returns `null` when the name is none of them. */
  private async handlePlanning(
    identity: AgentIdentity,
    input: Readonly<Record<string, unknown>>,
  ): Promise<PagesAgentReadResponse | PagesAgentWriteResponse | null> {
    const { operation, parameters } = input;
    const isNavigation =
      isAgentTicketNavigationRead(operation) ||
      isAgentTicketLinkOperation(operation);
    const isPlanning =
      operation === "ticket.read" ||
      operation === "milestones.read" ||
      isNavigation ||
      isAgentTicketOperation(operation) ||
      isAgentMilestoneOperation(operation);
    if (!isPlanning) return null;
    const { planning } = this.dependencies;
    if (!planning) throw new AgentOperationError("INVALID_REQUEST");
    if (isNavigation)
      return dispatchAgentTicketNavigation(
        planning,
        identity,
        operation,
        parameters,
      );
    if (operation === "ticket.read")
      return planning.reads.readTicket(identity, parameters);
    if (operation === "milestones.read")
      return planning.reads.readMilestones(identity, parameters);
    return isAgentTicketOperation(operation)
      ? planning.tickets.apply(identity, operation, parameters)
      : planning.milestones.apply(identity, operation, parameters);
  }

  /**
   * Reads one passage of a page or of a ticket description, or returns `null` for any other operation.
   *
   * @remarks
   * The passage is cut on the server: the complete text never leaves it, and a
   * hidden target is reported as missing exactly like in a full read.
   */
  private async handleTextRange(
    identity: AgentIdentity,
    input: Readonly<Record<string, unknown>>,
  ): Promise<PagesAgentReadResponse | null> {
    const { operation, parameters } = input;
    if (operation === "ticket.description.readRange") {
      const { planning } = this.dependencies;
      if (!planning) throw new AgentOperationError("INVALID_REQUEST");
      return planning.reads.readDescriptionRange(identity, parameters);
    }
    if (operation !== "wiki.page.readRange") return null;
    const { pageId, range } = readAgentWikiPageRange(parameters);
    const actor = await this.requireActor(identity);
    const wiki = this.wikiReads(actor, this.projectAccess());
    return {
      apiVersion: "1",
      result: await wiki.readRange(actor, pageId, range),
    };
  }

  /** Reads or sets the checklist of a ticket, or returns `null` for any other operation. */
  private async handleChecklist(
    identity: AgentIdentity,
    input: Readonly<Record<string, unknown>>,
  ): Promise<PagesAgentReadResponse | PagesAgentWriteResponse | null> {
    const { operation, parameters } = input;
    if (
      operation !== "ticket.checklist.read" &&
      operation !== "ticket.checklist.setItem"
    )
      return null;
    const { planning } = this.dependencies;
    if (!planning) throw new AgentOperationError("INVALID_REQUEST");
    return operation === "ticket.checklist.read"
      ? planning.checklists.read(identity, parameters)
      : planning.checklists.set(identity, parameters);
  }

  /** Reads the comments of a page or changes one; commenting needs no write capability. */
  private async handleComment(
    identity: AgentIdentity,
    operation: PagesAgentCommentOperation,
    parameters: unknown,
  ): Promise<PagesAgentReadResponse | PagesAgentWriteResponse> {
    const { comments } = this.dependencies;
    if (!comments) throw new AgentOperationError("INVALID_REQUEST");
    return operation === "wiki.comments.read"
      ? comments.read(identity, parameters)
      : comments.apply(identity, operation, parameters);
  }

  private async structuredImport(
    identity: AgentIdentity,
    input: Readonly<Record<string, unknown>>,
    verify: (() => Promise<AgentIdentity>) | undefined,
  ): Promise<PagesAgentStructuredReadResponse | PagesAgentWriteResponse> {
    const { structured } = this.dependencies;
    if (!structured) throw new AgentOperationError("INVALID_REQUEST");
    if (input.operation === "import.structured.plan")
      return structured.plan(identity, input.parameters);
    if (!verify) throw new AgentOperationError("INVALID_REQUEST");
    return structured.apply(identity, input.parameters, verify);
  }

  private async applyImport(
    identity: AgentIdentity,
    parameters: unknown,
    verify: (() => Promise<AgentIdentity>) | undefined,
  ): Promise<PagesAgentWriteResponse> {
    if (!this.dependencies.imports || !verify)
      throw new AgentOperationError("INVALID_REQUEST");
    return this.dependencies.imports.apply(identity, parameters, verify);
  }

  private async updateImport(
    identity: AgentIdentity,
    parameters: unknown,
    verify: (() => Promise<AgentIdentity>) | undefined,
  ): Promise<PagesAgentWriteResponse> {
    if (!this.dependencies.importUpdates || !verify)
      throw new AgentOperationError("INVALID_REQUEST");
    return this.dependencies.importUpdates.update(identity, parameters, verify);
  }

  private async changePage(
    identity: AgentIdentity,
    operation: AgentWikiPageOperation,
    parameters: unknown,
  ): Promise<PagesAgentWriteResponse> {
    if (!this.dependencies.fields)
      throw new AgentOperationError("INVALID_REQUEST");
    return this.dependencies.fields.apply(identity, operation, parameters);
  }

  private async planImport(
    identity: AgentIdentity,
    parameters: unknown,
  ): Promise<PagesAgentReadResponse> {
    const actor = await this.requireActor(identity);
    return new WikiImportPlanner(
      this.dependencies.wiki,
      createAgentWikiAccess(this.dependencies.projects, actor, this.channel),
    ).plan(actor, parameters);
  }

  private async requireActor(identity: AgentIdentity): Promise<User> {
    const actor = await this.dependencies.users.getById(identity.userId);
    if (!actor?.isActive || actor.mustChangePassword)
      throw new McpAuthorizationError("invalid_token", 401);
    return actor;
  }
}
