import { runRuntimeAcpTurn } from "./RuntimeAcpSession";

import type { MastraLanguageModel } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { RuntimeAcpOptions } from "./RuntimeAcpSession";

/** SDK model contract, excluding Mastra's internal streaming-only wrappers. */
export type RuntimeTextModel = Exclude<
  Extract<MastraModelConfig, { readonly specificationVersion: "v2" }>,
  MastraLanguageModel
>;

type ModelRequest = Parameters<RuntimeTextModel["doStream"]>[0];
type ModelResponse = Awaited<ReturnType<RuntimeTextModel["doStream"]>>;
type ModelChunk =
  ModelResponse["stream"] extends ReadableStream<infer Chunk> ? Chunk : never;

function textPrompt(request: ModelRequest): string {
  if (request.tools?.length || request.responseFormat?.type === "json")
    throw new Error(
      "ACP text models do not support Mastra tools or JSON output",
    );
  const messages = request.prompt.map((message) => {
    if (message.role === "system")
      return { role: message.role, content: message.content };
    if (message.role === "tool")
      throw new Error("ACP text models do not accept tool messages");
    const content = message.content.map((part) => {
      if (part.type !== "text")
        throw new Error("ACP text models accept text parts only");
      return part.text;
    });
    return { role: message.role, content: content.join("\n") };
  });
  return JSON.stringify({ messages });
}

function completedStream(output: string): ModelResponse {
  return {
    stream: new ReadableStream<ModelChunk>({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "acp-answer" });
        controller.enqueue({
          type: "text-delta",
          id: "acp-answer",
          delta: output,
        });
        controller.enqueue({ type: "text-end", id: "acp-answer" });
        controller.enqueue({
          type: "finish",
          finishReason: "stop",
          usage: {
            inputTokens: undefined,
            outputTokens: undefined,
            totalTokens: undefined,
          },
        });
        controller.close();
      },
    }),
  };
}

/**
 * Adapts buffered native ACP answers, not native tools, to Mastra's supported model API.
 *
 * @remarks
 * The native starter owns the exact configured model and credentials. This adapter
 * never reports invented token counts or converts ACP actions into Mastra tool calls.
 */
export function createRuntimeAcpModel(
  options: RuntimeAcpOptions & { readonly modelId: string },
): RuntimeTextModel {
  const binding = Object.freeze({ ...options });
  const run = async (request: ModelRequest): Promise<string> => {
    const prompt = textPrompt(request);
    return runRuntimeAcpTurn(binding, prompt, request.abortSignal);
  };
  return {
    specificationVersion: "v2",
    provider: `pages-acp-${binding.provider}`,
    modelId: binding.modelId,
    supportedUrls: {},
    doGenerate: async (request) => ({
      content: [{ type: "text", text: await run(request) }],
      finishReason: "stop",
      usage: {
        inputTokens: undefined,
        outputTokens: undefined,
        totalTokens: undefined,
      },
      warnings: [],
    }),
    doStream: async (request) => completedStream(await run(request)),
  };
}
