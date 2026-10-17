import { randomUUID } from "node:crypto";

import { createRuntimeAgent } from "@/backend/agents/runtime/RuntimeAgent";
import { createRuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import { ChatError } from "@/backend/error/ChatErrors";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { isApiProvider } from "@/definition/AgentConnection";
import { logCaughtError } from "@/backend/logging/Logger";

import { createPicaTools } from "./PicaTools";

import type {
  PicaApiModels,
  PicaApiModel,
} from "@/backend/agents/providers/PicaApiModels";
import type { TextExecutionInput } from "@/backend/agents/TextExecution";
import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { User } from "@/definition/User";
import type { ChatSessionService } from "./ChatSessionService";
import type { ChatToolExecutor } from "./ChatToolExecutor";

/** Server-built turn data: the person and the conversation the turn belongs to. */
export interface PicaApiInput extends TextExecutionInput {
  readonly actor: User;
  readonly sessionId: string;
}

/** Native API dependencies; there is deliberately no CLI execution or scheduler port. */
export interface PicaApiDependencies {
  readonly models: Pick<PicaApiModels, "use" | "authorize">;
  readonly sessions: Pick<ChatSessionService, "require" | "confirmationWord">;
  readonly tools: Pick<ChatToolExecutor, "run">;
}

/** Runs Pica through the shared Mastra agent and its native schema-bound tools. */
export class PicaApiService {
  private readonly dependencies: PicaApiDependencies;

  public constructor(dependencies: PicaApiDependencies) {
    this.dependencies = dependencies;
  }

  /** Creates a fresh server run and executes one bounded, non-retrying model/tool turn. */
  public async run(input: PicaApiInput, signal: AbortSignal): Promise<string> {
    if (!isApiProvider(input.agent.connection.provider))
      throw new ChatError("apiModeRequired");
    if (input.actor.id !== input.userId) throw new ChatError("accessDenied");
    const sessionContext = await createRuntimeExecutionContext(
      {
        actor: input.actor,
        sessionId: input.sessionId,
        runId: randomUUID(),
        signal,
      },
      this.dependencies.sessions,
    );
    const context: RuntimeExecutionContext = Object.freeze({
      ...sessionContext,
      authorize: async () => {
        await sessionContext.authorize();
        await this.dependencies.models.authorize(input.userId, input.agent);
        signal.throwIfAborted();
      },
    });
    try {
      return await this.dependencies.models.use(input, signal, (resolved) =>
        this.generate(input, context, resolved),
      );
    } catch (error: unknown) {
      logCaughtError("PicaApiService", error);

      signal.throwIfAborted();
      if (error instanceof ChatError || error instanceof TextAssistantError)
        throw error;
      throw new TextAssistantError("providerFailed");
    }
  }

  private async generate(
    input: PicaApiInput,
    context: RuntimeExecutionContext,
    resolved: PicaApiModel,
  ): Promise<string> {
    const agent = createRuntimeAgent({
      id: "pica-api",
      name: "Pica",
      instructions: input.instructions ?? "",
      model: resolved.model,
      context,
      maxSteps: 7,
      tools: createPicaTools({
        tools: this.dependencies.tools,
        sessions: this.dependencies.sessions,
        authorize: context.authorize,
      }),
    });
    const result = await agent.generate(input.prompt, {
      providerOptions: resolved.providerOptions,
      modelSettings: { maxRetries: 0, maxOutputTokens: 16_384 },
      toolCallConcurrency: { limit: 1, strategy: "called" },
    });
    context.signal.throwIfAborted();
    await context.authorize();
    if (result.finishReason === "tool-calls") throw new ChatError("stepLimit");
    if (result.finishReason !== "stop" || !result.text.trim())
      throw new TextAssistantError("invalidOutput");
    return resolved.redact(result.text);
  }
}
