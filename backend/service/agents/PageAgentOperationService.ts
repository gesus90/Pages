import { AgentError } from "@/backend/error/AgentErrors";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import {
  DEFAULT_AGENT_RUN_OPTIONS,
  emptyAgentConfiguration,
} from "@/definition/AgentConfiguration";
import {
  PAGE_AGENT_READ_OPERATIONS,
  PAGE_AGENT_WRITE_OPERATIONS,
} from "@/definition/PageAgentOperations";

import { pageAgentEntries } from "./AgentCursor";
import {
  fingerprintOperation,
  OperationRecorder,
  StoredOperationFound,
} from "./AgentOperationRecorder";
import { translatePageAgentError } from "./PageAgentOperationErrors";
import {
  readPageAgentListRequest,
  readPageAgentReadRequest,
  readPageAgentWriteRequest,
  requirePageAgentModelsRequest,
} from "./PageAgentOperationInput";
import {
  defaultPageAgentModel,
  defaultReasoningEffort,
} from "./PageAgentModels";

import type { Database } from "@/backend/database/Database";
import type { StoredAgentOperation } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PageAgent, PageAgentModel } from "@/definition/PageAgent";
import type {
  PageAgentChanged,
  PageAgentEntry,
  PageAgentModelEntry,
  PageAgentReadOperation,
  PageAgentSharingEntry,
  PageAgentWriteOperation,
} from "@/definition/PageAgentOperations";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { PageAgentService } from "./PageAgentService";
import type {
  PageAgentCreateRequest,
  PageAgentSharingRequest,
  PageAgentUpdateRequest,
  PageAgentWriteRequest,
} from "./PageAgentOperationInput";

/** The agent management and the database the results of its operations are stored in. */
export interface PageAgentOperationDependencies {
  readonly database: Pick<Database, "transaction">;
  readonly agents: PageAgentService;
}

function isReadOperation(value: unknown): value is PageAgentReadOperation {
  return PAGE_AGENT_READ_OPERATIONS.some((name) => name === value);
}

function isWriteOperation(value: unknown): value is PageAgentWriteOperation {
  return PAGE_AGENT_WRITE_OPERATIONS.some((name) => name === value);
}

function sharingOf(
  agent: PageAgent,
  directory: AgentProfileDirectory,
): PageAgentSharingEntry {
  const { sharing } = agent.configuration;
  const named = (
    kind: "group" | "department",
    entries: AgentProfileDirectory["groups"],
  ): PageAgentSharingEntry["groups"] =>
    sharing.targets
      .filter((target) => target.kind === kind)
      .flatMap((target) => {
        const entry = entries.find(({ id }) => id === target.targetId);
        return entry ? [{ id: entry.id, name: entry.name }] : [];
      });
  const groups = named("group", directory.groups);
  const departments = named("department", directory.departments);
  if (sharing.isGlobal)
    return { scope: "global", operator: null, groups: [], departments: [] };
  if (groups.length + departments.length === 0)
    return { scope: "private", operator: null, groups: [], departments: [] };
  return {
    scope: "restricted",
    operator: sharing.operator ?? "or",
    groups,
    departments,
  };
}

function toEntry(
  agent: PageAgent,
  directory: AgentProfileDirectory,
): PageAgentEntry {
  const { configuration } = agent;
  return {
    id: agent.id,
    name: agent.name,
    instruction: configuration.markdown,
    parameters: configuration.parameters,
    directoryParameter: configuration.directoryParameter,
    run: configuration.run ?? DEFAULT_AGENT_RUN_OPTIONS,
    modelProfileId: agent.modelProfileId,
    model: agent.model,
    reasoningEffort: agent.reasoningEffort,
    sharing: sharingOf(agent, directory),
    ownerId: agent.ownerId,
    canEdit: agent.canEdit,
    isUsable: agent.availability.isUsable,
    hasDeletedTargets: agent.hasDeletedTargets,
    revision: agent.revision ?? 1,
  };
}

function toModelEntry(
  model: PageAgentModel,
  defaultId: string | null,
): PageAgentModelEntry {
  return {
    modelProfileId: model.id,
    name: model.name,
    model: model.model,
    reasoning: model.reasoning,
    reasoningEfforts: model.reasoningEfforts,
    catalogDefaultReasoningEffort: model.catalogDefaultReasoningEffort,
    defaultReasoningEffort: defaultReasoningEffort(model),
    isDefault: model.id === defaultId,
  };
}

/** The share as the definition stores it; private and global keep no targets. */
function toSharing(
  request: PageAgentSharingRequest | undefined,
): AgentConfiguration["sharing"] {
  if (request === undefined || request.scope === "private")
    return { isGlobal: false, targets: [] };
  if (request.scope === "global") return { isGlobal: true, targets: [] };
  return {
    isGlobal: false,
    targets: [
      ...request.groupIds.map((targetId) => ({
        kind: "group" as const,
        targetId,
      })),
      ...request.departmentIds.map((targetId) => ({
        kind: "department" as const,
        targetId,
      })),
    ],
    operator: request.operator,
  };
}

/** Compares what a change may touch, so a request that matches the agent writes nothing. */
function definitionKey(input: {
  readonly name: string;
  readonly modelProfileId: string;
  readonly reasoningEffort: string | null;
  readonly configuration: AgentConfiguration;
}): string {
  const { configuration } = input;
  const { sharing } = configuration;
  const targets = sharing.targets
    .map((target) => `${target.kind}:${target.targetId}`)
    .sort();
  const hasTargets = !sharing.isGlobal && targets.length > 0;
  return JSON.stringify([
    input.name,
    input.modelProfileId,
    input.reasoningEffort,
    configuration.markdown,
    configuration.parameters,
    configuration.directoryParameter,
    sharing.isGlobal,
    hasTargets ? targets : [],
    hasTargets ? (sharing.operator ?? "or") : null,
  ]);
}

function readStoredResult(json: string): PageAgentChanged {
  const stored: unknown = JSON.parse(json);
  if (
    typeof stored !== "object" ||
    stored === null ||
    !("id" in stored) ||
    typeof stored.id !== "string" ||
    !("changed" in stored) ||
    typeof stored.changed !== "boolean" ||
    !("revision" in stored) ||
    typeof stored.revision !== "number"
  )
    throw new AgentOperationError("CONFLICT");
  return { id: stored.id, changed: stored.changed, revision: stored.revision };
}

/**
 * Lists, reads, creates and changes user agents for connected MCP clients.
 *
 * @remarks
 * Every call runs under the rules of the agent management: it decides which
 * agents a person sees, which models they may give one and whether a share
 * is valid, so the adapter holds no right of its own. The owner of a new agent
 * is the account of the credential; no other owner can be named. A change is
 * repeatable by its operation ID and refuses a stale `expectedRevision`. The
 * definition file is written by the management as it is for the interface.
 */
export class PageAgentOperationService {
  private readonly dependencies: PageAgentOperationDependencies;

  public constructor(dependencies: PageAgentOperationDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Handles an agent operation, returning `null` when another service owns the name.
   *
   * @param identity - The verified identity of the call.
   * @param operation - The operation name as received.
   * @param input - The raw parameters.
   * @throws {AgentOperationError} `INVALID_REQUEST`, `NOT_FOUND`, `FORBIDDEN` or `CONFLICT`.
   */
  public async handle(
    identity: AgentIdentity,
    operation: unknown,
    input: unknown,
  ): Promise<PagesAgentReadResponse | PagesAgentWriteResponse | null> {
    try {
      if (isReadOperation(operation))
        return await this.read(identity.userId, operation, input ?? {});
      if (isWriteOperation(operation))
        return await this.write(identity.userId, operation, input ?? {});
      return null;
    } catch (error: unknown) {
      throw translatePageAgentError(error);
    }
  }

  private async read(
    userId: string,
    operation: PageAgentReadOperation,
    input: unknown,
  ): Promise<PagesAgentReadResponse> {
    const { agents } = this.dependencies;
    if (operation === "agents.models.list") {
      requirePageAgentModelsRequest(input);
      const models = await agents.models(userId);
      const defaultId = defaultPageAgentModel(models)?.id ?? null;
      return {
        apiVersion: "1",
        result: {
          models: models.map((model) => toModelEntry(model, defaultId)),
        },
      };
    }
    if (operation === "agents.read") {
      const agentId = readPageAgentReadRequest(input);
      return {
        apiVersion: "1",
        result: { agent: await this.requireVisible(userId, agentId) },
      };
    }
    const request = readPageAgentListRequest(input);
    const visible = await agents.visibleAgents(userId);
    const page = pageAgentEntries(
      visible.agents.map((agent) => toEntry(agent, visible.directory)),
      {
        cursor: request.cursor,
        limit: request.limit,
        context: JSON.stringify([userId, operation]),
        // The management already orders by name, which is what a client expects to read.
        preserveOrder: true,
      },
    );
    return {
      apiVersion: "1",
      result: {
        agents: page.entries,
        total: page.total,
        nextCursor: page.nextCursor,
      },
    };
  }

  /** The agent as the person sees it; one they cannot see answers like a missing one. */
  private async requireVisible(
    userId: string,
    agentId: string,
  ): Promise<PageAgentEntry> {
    const visible = await this.dependencies.agents.visibleAgents(userId);
    const agent = visible.agents.find((entry) => entry.id === agentId);
    if (!agent) throw new AgentOperationError("NOT_FOUND");
    return toEntry(agent, visible.directory);
  }

  private async write(
    userId: string,
    operation: PageAgentWriteOperation,
    input: unknown,
  ): Promise<PagesAgentWriteResponse> {
    const request = readPageAgentWriteRequest(operation, input);
    const stored = await this.lookup(userId, request.operationId);
    if (stored) return this.replay(userId, request, stored);
    const recorder = new OperationRecorder<PageAgentChanged>(userId, request);
    try {
      if (request.operation === "agents.create")
        await this.create(userId, request, recorder);
      else await this.update(userId, request, recorder);
    } catch (error: unknown) {
      // A parallel call with the same operation ID may have committed between
      // the lookup and the write; whatever refused this one, that call's
      // result is the answer.
      const completed =
        error instanceof StoredOperationFound
          ? error.stored
          : await this.lookup(userId, request.operationId);
      if (completed) return this.replay(userId, request, completed);
      throw error;
    }
    return { apiVersion: "1", result: recorder.result };
  }

  private async lookup(
    userId: string,
    operationId: string,
  ): Promise<StoredAgentOperation | null> {
    return this.dependencies.database.transaction((transaction) =>
      new AgentOperationKeyRepository(transaction).find(userId, operationId),
    );
  }

  /** Shows a stored result again only while the person still owns the agent. */
  private async replay(
    userId: string,
    request: PageAgentWriteRequest,
    stored: StoredAgentOperation,
  ): Promise<PagesAgentWriteResponse> {
    if (
      stored.operation !== request.operation ||
      stored.fingerprint !== fingerprintOperation(request)
    )
      throw new AgentOperationError("CONFLICT");
    const result = readStoredResult(stored.resultJson);
    const agent = await this.requireVisible(userId, result.id);
    if (!agent.canEdit) throw new AgentOperationError("NOT_FOUND");
    return { apiVersion: "1", result };
  }

  /** Picks the model the call names, or the one Pages applies when it names none. */
  private async selectModel(
    userId: string,
    modelProfileId: string | undefined,
  ): Promise<PageAgentModel> {
    const models = await this.dependencies.agents.models(userId);
    if (modelProfileId === undefined) {
      const fallback = defaultPageAgentModel(models);
      if (fallback === null)
        throw new AgentOperationError("FORBIDDEN", {
          reason: "default_model_unavailable",
        });
      return fallback;
    }
    const model = models.find((entry) => entry.id === modelProfileId);
    if (!model)
      throw new AgentOperationError("INVALID_REQUEST", {
        reason: "model_unavailable",
      });
    return model;
  }

  private async create(
    userId: string,
    request: PageAgentCreateRequest,
    recorder: OperationRecorder<PageAgentChanged>,
  ): Promise<void> {
    const { fields } = request;
    const model = await this.selectModel(userId, fields.modelProfileId);
    const reasoningEffort =
      fields.reasoningEffort === undefined
        ? defaultReasoningEffort(model)
        : fields.reasoningEffort;
    // A model that lists levels does not take "no effort"; ask instead of guessing.
    if (reasoningEffort === null && model.reasoningEfforts.length > 0)
      throw new AgentOperationError("INVALID_REQUEST", {
        reason:
          fields.reasoningEffort === undefined
            ? "reasoning_required"
            : "reasoning_unsupported",
      });
    const configuration: AgentConfiguration = {
      ...emptyAgentConfiguration("person"),
      accessMode: "shared",
      markdown: fields.instruction ?? "",
      parameters: fields.parameters ?? [],
      directoryParameter: fields.directoryParameter ?? null,
      sharing: toSharing(fields.sharing),
    };
    await this.dependencies.agents.save(
      userId,
      null,
      {
        name: fields.name,
        modelProfileId: model.id,
        reasoningEffort,
        configuration,
      },
      (transaction, profile) =>
        recorder.store(transaction, {
          id: profile.id,
          changed: true,
          revision: 1,
        }),
    );
  }

  /** The agent as the client last read it: visible, owned and not changed since. */
  private async requireCurrent(
    userId: string,
    request: PageAgentUpdateRequest,
  ): Promise<PageAgent> {
    const visible = await this.dependencies.agents.visibleAgents(userId);
    const agent = visible.agents.find((entry) => entry.id === request.agentId);
    if (!agent) throw new AgentOperationError("NOT_FOUND");
    if (!agent.canEdit) throw new AgentOperationError("FORBIDDEN");
    if ((agent.revision ?? 1) !== request.expectedRevision)
      throw new AgentOperationError("CONFLICT", {
        currentRevision: agent.revision ?? 1,
      });
    // Saving writes the list without the groups and departments that are gone,
    // which can widen an AND share; the owner decides that explicitly.
    if (agent.hasDeletedTargets && request.fields.sharing === undefined)
      throw new AgentOperationError("INVALID_REQUEST", {
        reason: "sharing_changes_required",
      });
    return agent;
  }

  private async update(
    userId: string,
    request: PageAgentUpdateRequest,
    recorder: OperationRecorder<PageAgentChanged>,
  ): Promise<void> {
    const current = await this.requireCurrent(userId, request);
    const { fields } = request;
    const { configuration } = current;
    const proposed = {
      name: fields.name ?? current.name,
      modelProfileId: fields.modelProfileId ?? current.modelProfileId,
      reasoningEffort:
        fields.reasoningEffort === undefined
          ? current.reasoningEffort
          : fields.reasoningEffort,
      configuration: {
        ...configuration,
        markdown: fields.instruction ?? configuration.markdown,
        parameters: fields.parameters ?? configuration.parameters,
        directoryParameter:
          fields.directoryParameter === undefined
            ? configuration.directoryParameter
            : fields.directoryParameter,
        sharing:
          fields.sharing === undefined
            ? configuration.sharing
            : toSharing(fields.sharing),
      },
    };
    const revision = request.expectedRevision;
    if (definitionKey(proposed) === definitionKey(current)) {
      await this.dependencies.database.transaction((transaction) =>
        recorder.store(transaction, {
          id: current.id,
          changed: false,
          revision,
        }),
      );
      return;
    }
    try {
      await this.dependencies.agents.save(
        userId,
        current.id,
        { ...proposed, revision },
        (transaction) =>
          recorder.store(transaction, {
            id: current.id,
            changed: true,
            revision: revision + 1,
          }),
      );
    } catch (error: unknown) {
      if (error instanceof AgentError && error.code === "profile_conflict")
        throw await this.conflict(userId, current.id);
      throw error;
    }
  }

  /** A save lost to a change made in between answers with the revision to read next. */
  private async conflict(
    userId: string,
    agentId: string,
  ): Promise<AgentOperationError> {
    const visible = await this.dependencies.agents.visibleAgents(userId);
    const agent = visible.agents.find((entry) => entry.id === agentId);
    if (!agent) return new AgentOperationError("NOT_FOUND");
    return new AgentOperationError("CONFLICT", {
      currentRevision: agent.revision ?? 1,
    });
  }
}
