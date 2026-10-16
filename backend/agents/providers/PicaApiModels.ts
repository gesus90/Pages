import { ModelsDevGateway } from "@mastra/core/llm";
import { z } from "zod";

import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { AGENT_PROVIDERS, isApiProvider } from "@/definition/AgentConnection";

import type { AgentExecutionOptions } from "@mastra/core/agent";
import type { RuntimeModel } from "@/backend/agents/runtime/RuntimeAgent";
import type { ExecutionAuthorizer } from "@/backend/agents/ScopedExecution";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";
import type { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import type { ApiProviderId } from "@/definition/AgentConnection";

const ANTHROPIC_EFFORT = z.enum(["low", "medium", "high", "xhigh", "max"]);
const GOOGLE_EFFORT = z.enum(["minimal", "low", "medium", "high"]);

/** A model credential stays inside its provider closure; callers can only redact its exact text. */
export interface PicaApiModel {
  readonly model: RuntimeModel;
  readonly providerOptions: AgentExecutionOptions["providerOptions"];
  readonly redact: (text: string) => string;
}

/** Fresh access, credential persistence and shared connection locking for native Pica runs. */
export interface PicaApiModelDependencies {
  readonly connections: Pick<
    AgentConnectionRepository,
    "find" | "findSecretEncrypted"
  >;
  readonly cipher: Pick<InstanceSecretCipher, "decrypt">;
  readonly access: ExecutionAuthorizer;
  readonly operations: Pick<AgentOperationRegistry, "acquireExecution">;
}

/** Prevents the SDK gateway from consulting endpoint overrides in process.env. */
class PagesModelGateway extends ModelsDevGateway {
  private readonly endpoint: string;

  public constructor(provider: ApiProviderId) {
    super();
    this.endpoint = AGENT_PROVIDERS[provider].endpoint;
  }

  /** Always returns the fixed Pages endpoint, independent of model or environment metadata. */
  public override buildUrl(): string {
    return this.endpoint;
  }
}

function providerOptions(
  provider: ApiProviderId,
  effort: string | null,
): PicaApiModel["providerOptions"] {
  if (provider === "openrouter")
    return {
      openrouter: {
        provider: { allow_fallbacks: false },
        ...(effort === null ? {} : { reasoning: { effort } }),
      },
    };
  if (provider === "openai")
    return {
      openai: {
        store: false,
        ...(effort === null ? {} : { reasoningEffort: effort }),
      },
    };
  if (effort === null) return {};
  if (provider === "anthropic")
    return { anthropic: { effort: ANTHROPIC_EFFORT.parse(effort) } };
  if (provider === "google_ai_studio")
    return {
      google: {
        thinkingConfig: {
          thinkingLevel: GOOGLE_EFFORT.parse(effort.toLowerCase()),
        },
      },
    };
  return { zai: { reasoningEffort: effort } };
}

/** Uses the SDK models already bundled with Mastra, without environment credentials or another planner. */
export class PicaApiModels {
  private readonly dependencies: PicaApiModelDependencies;

  public constructor(dependencies: PicaApiModelDependencies) {
    this.dependencies = dependencies;
  }

  /** Rechecks persisted account scope and active connection before every model or tool call. */
  public async authorize(
    userId: string,
    agent: ResolvedAgentAssignment,
  ): Promise<void> {
    if (!isApiProvider(agent.connection.provider))
      throw new TextAssistantError("connectionUnavailable");
    await this.dependencies.access.requireUser(userId, agent.connection.id);
    const current = await this.dependencies.connections.find(
      agent.connection.id,
    );
    if (
      !current?.isActive ||
      !current.hasApiKey ||
      current.provider !== agent.connection.provider
    )
      throw new TextAssistantError("connectionUnavailable");
  }

  /** Holds the existing shared connection lock for the complete native model/tool turn. */
  public async use<Result>(
    input: { readonly userId: string; readonly agent: ResolvedAgentAssignment },
    signal: AbortSignal,
    run: (resolved: PicaApiModel) => Promise<Result>,
  ): Promise<Result> {
    const release = this.dependencies.operations.acquireExecution(
      input.agent.connection.id,
    );
    try {
      await this.authorize(input.userId, input.agent);
      signal.throwIfAborted();
      return await run(await this.resolve(input.agent));
    } finally {
      release();
    }
  }

  private async resolve(agent: ResolvedAgentAssignment): Promise<PicaApiModel> {
    const { id, provider } = agent.connection;
    if (!isApiProvider(provider))
      throw new TextAssistantError("connectionUnavailable");
    const encrypted =
      await this.dependencies.connections.findSecretEncrypted(id);
    if (encrypted === null)
      throw new TextAssistantError("connectionUnavailable");
    let apiKey: string;
    try {
      apiKey = this.dependencies.cipher.decrypt(id, encrypted);
    } catch {
      throw new TextAssistantError("connectionUnavailable");
    }
    if (!apiKey.trim()) throw new TextAssistantError("connectionUnavailable");
    const model = await new PagesModelGateway(provider).resolveLanguageModel({
      providerId: provider === "google_ai_studio" ? "google" : provider,
      modelId:
        provider === "google_ai_studio"
          ? agent.model.replace(/^models\//u, "")
          : agent.model,
      apiKey,
    });
    return {
      model,
      providerOptions: providerOptions(provider, agent.reasoningEffort),
      redact: (text) => text.replaceAll(apiKey, "[redacted]"),
    };
  }
}
