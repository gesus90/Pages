import { vi } from "vitest";

import { createRuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { RuntimeTextModel } from "@/backend/agents/runtime/RuntimeAcpModel";
import type { ChatSessionService } from "@/backend/service/chat/ChatSessionService";
import type { User } from "@/definition/User";

export const runtimeActor: User = {
  id: "runtime-owner",
  username: "runtime-owner",
  displayName: "Runtime Owner",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
export const runtimeSessionId = "one-two-three-four-five";

/** Creates a server context at mocked ownership boundaries, without a database. */
export async function runtimeContext(): Promise<{
  readonly context: RuntimeExecutionContext;
  readonly controller: AbortController;
  readonly sessions: {
    readonly require: ReturnType<typeof vi.fn<ChatSessionService["require"]>>;
  };
}> {
  const controller = new AbortController();
  const sessions = {
    require: vi.fn<ChatSessionService["require"]>(async () => ({
      id: runtimeSessionId,
      createdAt: "2026-10-16T00:00:00Z",
      lastMessageAt: "2026-10-16T00:00:00Z",
      preview: "",
    })),
  };
  const context = await createRuntimeExecutionContext(
    {
      actor: runtimeActor,
      sessionId: runtimeSessionId,
      runId: "runtime-run",
      signal: controller.signal,
    },
    sessions,
  );
  return { context, controller, sessions };
}

type ModelResponse = Awaited<ReturnType<RuntimeTextModel["doStream"]>>;
type GeneratedResponse = Awaited<ReturnType<RuntimeTextModel["doGenerate"]>>;
export type ModelRequest = Parameters<RuntimeTextModel["doStream"]>[0];
export type ModelChunk =
  ModelResponse["stream"] extends ReadableStream<infer Chunk> ? Chunk : never;

/** A fake provider result using the real supported SDK stream protocol. */
export function responseChunks(text: string): ModelChunk[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "answer" },
    { type: "text-delta", id: "answer", delta: text },
    { type: "text-end", id: "answer" },
    {
      type: "finish",
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    },
  ];
}

function generatedResponse(chunks: ModelChunk[]): GeneratedResponse {
  const content: GeneratedResponse["content"] = [];
  for (const chunk of chunks) {
    if (chunk.type === "text-delta")
      content.push({ type: "text", text: chunk.delta });
    if (chunk.type === "tool-call") content.push(chunk);
  }
  const finish = chunks.find((chunk) => chunk.type === "finish");
  return {
    content,
    finishReason: finish?.finishReason ?? "stop",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    warnings: [],
  };
}

/** Injects a fake model; the Agent, tool validation and loop remain real Mastra code. */
export function fakeRuntimeModel(
  respond: (request: ModelRequest, call: number) => ModelChunk[] = () =>
    responseChunks("answer"),
): {
  readonly model: RuntimeTextModel;
  readonly calls: ReturnType<
    typeof vi.fn<(request: ModelRequest) => ModelChunk[]>
  >;
} {
  let call = 0;
  const calls = vi.fn((request: ModelRequest) => respond(request, call++));
  const stream = async (request: ModelRequest): Promise<ModelResponse> => {
    const chunks = calls(request);
    return {
      stream: new ReadableStream<ModelChunk>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
    };
  };
  const model: RuntimeTextModel = {
    specificationVersion: "v2",
    provider: "pages-fake",
    modelId: "fake-model",
    supportedUrls: {},
    doGenerate: async (request) => generatedResponse(calls(request)),
    doStream: stream,
  };
  return { model, calls };
}

/** A tool call followed by a final answer on the next real Mastra step. */
export function toolModel(
  toolName: string,
  input: unknown,
): ReturnType<typeof fakeRuntimeModel> {
  return fakeRuntimeModel((_, call) => {
    if (call > 0) return responseChunks("done");
    return [
      { type: "stream-start", warnings: [] },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName,
        input: JSON.stringify(input),
      },
      {
        type: "finish",
        finishReason: "tool-calls",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      },
    ];
  });
}
