import { AgentOperationError } from "@/backend/error/AgentOperationError";

import {
  readChatAgentCloneRequest,
  readChatAgentDeleteRequest,
} from "./ChatAgentOperationInput";
import { OperationRecorder } from "./AgentOperationRecorder";
import { proposePageAgent } from "./PageAgentOperationDefinition";
import { translatePageAgentError } from "./PageAgentOperationErrors";
import { PageAgentOperationService } from "./PageAgentOperationService";

import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { PageAgent } from "@/definition/PageAgent";
import type { PageAgentChanged } from "@/definition/PageAgentOperations";
import type { ChatAgentDeleted } from "@/definition/ChatAgentOperations";
import type { PagesAgentReadResponse } from "@/definition/PagesAgentOperations";
import type { PagesAgentWriteResponse } from "@/definition/PagesAgentWrites";
import type {
  ChatAgentCloneRequest,
  ChatAgentDeleteRequest,
} from "./ChatAgentOperationInput";
import type { PageAgentOperationDependencies } from "./PageAgentOperationService";

/** Adds cloning and confirmed deletion to the existing Pages-owned agent operations for chat. */
export class ChatAgentOperationService {
  private readonly dependencies: PageAgentOperationDependencies;
  private readonly operations: PageAgentOperationService;

  public constructor(dependencies: PageAgentOperationDependencies) {
    this.dependencies = dependencies;
    this.operations = new PageAgentOperationService(dependencies);
  }

  /** Dispatches agent actions for the verified signed-in identity, with no technical actor. */
  public async handle(
    identity: AgentIdentity,
    operation: unknown,
    input: unknown,
  ): Promise<PagesAgentReadResponse | PagesAgentWriteResponse | null> {
    try {
      if (operation === "agents.clone")
        return await this.clone(
          identity.userId,
          readChatAgentCloneRequest(input),
        );
      if (operation === "agents.delete")
        return await this.remove(
          identity.userId,
          readChatAgentDeleteRequest(input),
        );
      return await this.operations.handle(identity, operation, input);
    } catch (error: unknown) {
      throw translatePageAgentError(error);
    }
  }

  private async current(
    userId: string,
    request: { readonly agentId: string; readonly expectedRevision: number },
  ): Promise<PageAgent> {
    const { agents } = await this.dependencies.agents.visibleAgents(userId);
    const agent = agents.find((entry) => entry.id === request.agentId);
    if (!agent) throw new AgentOperationError("NOT_FOUND");
    if ((agent.revision ?? 1) !== request.expectedRevision)
      throw new AgentOperationError("CONFLICT", {
        currentRevision: agent.revision ?? 1,
      });
    return agent;
  }

  private async clone(
    userId: string,
    request: ChatAgentCloneRequest,
  ): Promise<PagesAgentWriteResponse> {
    const source = await this.current(userId, request);
    if (source.hasDeletedTargets && request.fields.sharing === undefined)
      throw new AgentOperationError("INVALID_REQUEST", {
        reason: "sharing_changes_required",
      });
    const proposed = proposePageAgent(source, request.fields);
    const recorder = new OperationRecorder<PageAgentChanged>(userId, request);
    await this.dependencies.agents.clone(
      userId,
      {
        id: source.id,
        expectedRevision: request.expectedRevision,
        preserveModel: request.fields.modelProfileId === undefined,
      },
      proposed,
      (transaction, profile) =>
        recorder.store(transaction, {
          id: profile.id,
          changed: true,
          revision: 1,
        }),
    );
    return { apiVersion: "1", result: recorder.result };
  }

  private async remove(
    userId: string,
    request: ChatAgentDeleteRequest,
  ): Promise<PagesAgentWriteResponse> {
    const agent = await this.current(userId, request);
    if (!agent.canEdit) throw new AgentOperationError("FORBIDDEN");
    const recorder = new OperationRecorder<ChatAgentDeleted>(userId, request);
    await this.dependencies.agents.remove(userId, agent.id, {
      expectedRevision: request.expectedRevision,
      journal: (transaction) =>
        recorder.store(transaction, { id: agent.id, deleted: true }),
    });
    return { apiVersion: "1", result: recorder.result };
  }
}
