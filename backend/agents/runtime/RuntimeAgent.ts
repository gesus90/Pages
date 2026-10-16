import { Agent } from "@mastra/core/agent";
import { noopLogger } from "@mastra/core/logger";
import { RequestContext } from "@mastra/core/request-context";

import type { MastraLanguageModel } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { RuntimeExecutionContext } from "./RuntimeExecutionContext";
import type { RuntimeToolRegistry } from "./RuntimeToolRegistry";

/** Explicit modern model objects; excludes global environment routing and legacy APIs. */
export type RuntimeModel = Exclude<
  Extract<
    MastraModelConfig,
    { readonly specificationVersion: "v2" | "v3" | "v4" }
  >,
  MastraLanguageModel
>;

/** Configuration of one invocation-scoped Mastra agent. */
export interface RuntimeAgentOptions {
  readonly id: string;
  readonly name: string;
  readonly instructions: string;
  readonly model: RuntimeModel;
  readonly context: RuntimeExecutionContext;
  readonly tools?: RuntimeToolRegistry;
  readonly maxSteps?: number;
}

/** Creates a real Mastra agent; Mastra alone owns its model/tool loop and streams. */
export function createRuntimeAgent(options: RuntimeAgentOptions): Agent {
  const { context, model } = options;
  const maxSteps = options.maxSteps ?? 5;
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1)
    throw new Error("Runtime maxSteps must be a positive integer");
  const agent = new Agent({
    id: options.id,
    name: options.name,
    instructions: options.instructions,
    model: async () => {
      await context.authorize();
      return model;
    },
    tools: options.tools?.bind(context),
    defaultOptions: () => ({
      runId: context.runId,
      abortSignal: context.signal,
      requestContext: new RequestContext([
        ["pages.userId", context.userId],
        ["pages.sessionId", context.sessionId],
        ["pages.runId", context.runId],
      ]),
      maxSteps,
      modelSettings: { maxRetries: 0 },
    }),
  });
  agent.__registerPrimitives({ logger: noopLogger });
  return agent;
}
