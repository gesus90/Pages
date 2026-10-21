import { AgentOperationError } from "@/backend/error/AgentOperationError";
import {
  DEFAULT_AGENT_RUN_OPTIONS,
  agentRunOptionsFor,
} from "@/definition/AgentConfiguration";
import {
  PAGE_AGENT_READ_OPERATIONS,
  PAGE_AGENT_WRITE_OPERATIONS,
} from "@/definition/PageAgentOperations";
import { PAGES_AGENT_LIMITS } from "@/definition/PagesAgentOperations";
import { logCaughtError } from "@/backend/logging/Logger";
import { sharingEntry } from "./PageAgentOperationDefinition";
import { pageAgentEntries } from "./AgentCursor";
import { translatePageAgentError } from "./PageAgentOperationErrors";
import {
  readPageAgentListRequest,
  readPageAgentReadRequest,
  requirePageAgentModelsRequest,
} from "./PageAgentOperationInput";

import type { Database } from "@/backend/database/Database";
import type { AgentProfileDirectory } from "@/definition/AgentProfile";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PageAgent, PageAgentModel } from "@/definition/PageAgent";
import type {
  PageAgentEntry,
  PageAgentList,
  PageAgentRead,
  PageAgentModelEntry,
  PageAgentReadOperation,
  PageAgentWriteOperation,
} from "@/definition/PageAgentOperations";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type { PageAgentService } from "./PageAgentService";

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

function toEntry(
  agent: PageAgent,
  directory: AgentProfileDirectory,
): PageAgentEntry {
  const { configuration } = agent;
  return {
    id: agent.id,
    name: agent.name,
    // Keep conflict and access facts readable when the chat truncates a long instruction.
    revision: agent.revision ?? 1,
    ownerId: agent.ownerId,
    canEdit: agent.canEdit,
    directoryParameter: configuration.directoryParameter,
    // What the runner applies; without a model there is no runner to derive it from.
    run:
      agent.provider === null
        ? (configuration.run ?? DEFAULT_AGENT_RUN_OPTIONS)
        : agentRunOptionsFor(agent.provider, configuration.run),
    modelProfileId: agent.modelProfileId,
    model: agent.model,
    reasoningEffort: agent.reasoningEffort,
    sharing: sharingEntry(configuration.sharing, directory),
    isUsable: agent.availability.isUsable,
    hasDeletedTargets: agent.hasDeletedTargets,
    parameters: configuration.parameters,
    instruction: configuration.markdown,
  };
}

function toModelEntry(
  model: PageAgentModel,
  defaultId: string | null,
): PageAgentModelEntry {
  return {
    modelProfileId: model.id,
    connectionId: model.connectionId,
    provider: model.provider,
    name: model.name,
    model: model.model,
    reasoning: model.reasoning,
    reasoningEfforts: model.reasoningEfforts,
    catalogDefaultReasoningEffort: model.catalogDefaultReasoningEffort,
    defaultReasoningEffort: null,
    isDefault: model.id === defaultId,
  };
}

/**
 * Wraps a read of agents in the envelope within the response budget.
 *
 * @remarks
 * An agent carries an instruction of up to 200,000 characters, so a full page
 * of them can exceed the budget; the client asks for fewer with `limit`.
 */
function respond(
  result: PageAgentList | PageAgentRead,
): PagesAgentReadResponse {
  const response: PagesAgentReadResponse = { apiVersion: "1", result };
  if (
    Buffer.byteLength(JSON.stringify(response)) >
    PAGES_AGENT_LIMITS.responseBytes
  )
    throw new AgentOperationError("PAYLOAD_TOO_LARGE", {
      constraint: "responseBytes",
      limit: PAGES_AGENT_LIMITS.responseBytes,
    });
  return response;
}

/**
 * Reads retained user definitions and direct connection models; definition writes are retired.
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
        throw new AgentOperationError("INVALID_REQUEST", {
          reason: "operation_retired",
        });
      return null;
    } catch (error: unknown) {
      logCaughtError("PageAgentOperationService", error);

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
      const defaultId = null;
      return {
        apiVersion: "1",
        result: {
          models: models.map((model) => toModelEntry(model, defaultId)),
        },
      };
    }
    if (operation === "agents.read") {
      const agentId = readPageAgentReadRequest(input);
      return respond({ agent: await this.requireVisible(userId, agentId) });
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
    return respond({
      agents: page.entries,
      total: page.total,
      nextCursor: page.nextCursor,
    });
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
}
