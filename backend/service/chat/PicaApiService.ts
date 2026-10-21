import { randomUUID } from "node:crypto";

import { createRuntimeAgent } from "@/backend/agents/runtime/RuntimeAgent";
import { createRuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import { ChatError } from "@/backend/error/ChatErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { isApiProvider } from "@/definition/AgentConnection";
import { logCaughtError } from "@/backend/logging/Logger";

import { CHAT_MAXIMUM_MODEL_STEPS } from "./ChatExecutionLimits";
import { createPicaTools } from "./PicaTools";

import type {
  PicaApiModels,
  PicaApiModel,
} from "@/backend/agents/providers/PicaApiModels";
import type { Agent } from "@mastra/core/agent";
import type { TextExecutionInput } from "@/backend/agents/TextExecution";
import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { User } from "@/definition/User";
import type { ChatAnswerFileService } from "./ChatAnswerFileService";
import type { ChatSessionService } from "./ChatSessionService";
import type { ChatToolExecutor } from "./ChatToolExecutor";

/** A raster image of the current message, sent to the model as image content. */
export interface PicaApiImage {
  readonly data: Buffer;
  readonly mediaType: string;
}

/** Server-built turn data: the person and the conversation the turn belongs to. */
export interface PicaApiInput extends TextExecutionInput {
  readonly actor: User;
  readonly sessionId: string;
  /** The run the answer files of this turn belong to; a fresh one by default. */
  readonly runId?: string;
  /** Images of the current message; the model reads them next to the prompt (PAGE-92). */
  readonly images?: readonly PicaApiImage[];
}

/** Native API dependencies; there is deliberately no CLI execution or scheduler port. */
export interface PicaApiDependencies {
  readonly models: Pick<PicaApiModels, "use" | "authorize">;
  readonly sessions: Pick<ChatSessionService, "require" | "confirmationWord">;
  readonly tools: Pick<ChatToolExecutor, "run">;
  /** Stores files Pica writes for its answer; without it the file tool is not offered. */
  readonly answerFiles?: Pick<ChatAnswerFileService, "stage">;
  readonly requireCurrent?: (input: PicaApiInput) => Promise<void>;
}

/** The prompt alone, or the prompt with the images of the message as one user message. */
function modelInput(input: PicaApiInput): Parameters<Agent["generate"]>[0] {
  const images = input.images ?? [];
  if (images.length === 0) return input.prompt;
  return [
    {
      role: "user",
      content: [
        { type: "text", text: input.prompt },
        ...images.map((image) => ({
          type: "image" as const,
          image: image.data,
          mediaType: image.mediaType,
        })),
      ],
    },
  ];
}

/** Runs Pica through the shared Mastra agent and its native schema-bound tools. */
export class PicaApiService {
  private readonly dependencies: PicaApiDependencies;

  public constructor(dependencies: PicaApiDependencies) {
    this.dependencies = dependencies;
  }

  /** Creates a fresh server run and executes one bounded, non-retrying model/tool turn. */
  public async run(input: PicaApiInput, signal: AbortSignal): Promise<string> {
    await this.dependencies.requireCurrent?.(input);
    if (!isApiProvider(input.agent.connection.provider))
      throw new ChatError("apiModeRequired");
    if (input.actor.id !== input.userId) throw new ChatError("accessDenied");
    const sessionContext = await createRuntimeExecutionContext(
      {
        actor: input.actor,
        sessionId: input.sessionId,
        runId: input.runId ?? randomUUID(),
        signal,
      },
      this.dependencies.sessions,
    );
    const context: RuntimeExecutionContext = Object.freeze({
      ...sessionContext,
      authorize: async () => {
        await sessionContext.authorize();
        await this.dependencies.requireCurrent?.(input);
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
      if (error instanceof ChatError || error instanceof AgentExecutionError)
        throw error;
      throw new AgentExecutionError("providerFailed");
    }
  }

  private async generate(
    input: PicaApiInput,
    context: RuntimeExecutionContext,
    resolved: PicaApiModel,
  ): Promise<string> {
    let isLimitExceeded = false;
    const agent = createRuntimeAgent({
      id: "pica-api",
      name: "Pica",
      instructions: input.instructions ?? "",
      model: resolved.model,
      context,
      maxSteps: CHAT_MAXIMUM_MODEL_STEPS,
      tools: createPicaTools({
        tools: this.dependencies.tools,
        sessions: this.dependencies.sessions,
        authorize: context.authorize,
        onLimit: () => {
          isLimitExceeded = true;
        },
        ...(this.dependencies.answerFiles
          ? { answerFiles: this.dependencies.answerFiles }
          : {}),
      }),
    });
    const result = await agent.generate(modelInput(input), {
      providerOptions: resolved.providerOptions,
      modelSettings: { maxRetries: 0, maxOutputTokens: 16_384 },
      toolCallConcurrency: { limit: 1, strategy: "called" },
    });
    context.signal.throwIfAborted();
    await context.authorize();
    if (isLimitExceeded || result.finishReason === "tool-calls")
      throw new ChatError("stepLimit");
    if (result.finishReason !== "stop" || !result.text.trim())
      throw new AgentExecutionError("invalidOutput");
    return resolved.redact(result.text);
  }
}
