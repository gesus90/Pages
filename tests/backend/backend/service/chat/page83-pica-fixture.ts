import { vi } from "vitest";

import { PicaApiService } from "@/backend/service/chat/PicaApiService";
import { ChatToolExecutor } from "@/backend/service/chat/ChatToolExecutor";

import {
  fakeRuntimeModel,
  responseChunks,
} from "../../agents/runtime/runtime-fixture";
import { ASSIGNMENT, FIRST, OWNER, SESSION } from "./page48-chat-fixture";

import type {
  ModelChunk,
  ModelRequest,
} from "../../agents/runtime/runtime-fixture";
import type { PicaApiModels } from "@/backend/agents/providers/PicaApiModels";
import type { ChatSessionService } from "@/backend/service/chat/ChatSessionService";
import type { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import type { PicaApiInput } from "@/backend/service/chat/PicaApiService";

/** Emits real SDK native calls, without parsing or executing a text-action protocol. */
export function picaToolCalls(
  calls: readonly { readonly tool: string; readonly input: unknown }[],
): ModelChunk[] {
  return [
    { type: "stream-start", warnings: [] },
    ...calls.map(({ tool, input }, index): ModelChunk => ({
      type: "tool-call",
      toolCallId: `call-${index}`,
      toolName: tool,
      input: JSON.stringify(input),
    })),
    {
      type: "finish",
      finishReason: "tool-calls",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    },
  ];
}

/** Cohesive native Pica unit: real Mastra and ChatToolExecutor, fake model, session and operation boundaries. */
export function picaWorld(
  respond: (request: ModelRequest, call: number) => ModelChunk[] = () =>
    responseChunks("Antwort"),
): {
  readonly provider: ReturnType<typeof fakeRuntimeModel>;
  readonly authorize: ReturnType<typeof vi.fn<PicaApiModels["authorize"]>>;
  readonly sessions: {
    readonly require: ReturnType<typeof vi.fn<ChatSessionService["require"]>>;
  };
  readonly router: ReturnType<typeof vi.fn<AgentOperationRouter["handle"]>>;
  readonly verify: ReturnType<
    typeof vi.fn<
      (userId: string) => Promise<{
        userId: string;
        isAdmin: boolean;
        permissions: readonly [];
      }>
    >
  >;
  readonly models: Pick<PicaApiModels, "use" | "authorize">;
  readonly service: PicaApiService;
  readonly input: PicaApiInput;
  readonly controller: AbortController;
} {
  const provider = fakeRuntimeModel(respond);
  const authorize = vi.fn<PicaApiModels["authorize"]>(async () => undefined);
  const models: Pick<PicaApiModels, "use" | "authorize"> = {
    authorize,
    use: async (_, signal, run) => {
      signal.throwIfAborted();
      return run({
        model: provider.model,
        providerOptions: {},
        redact: (text) => text,
      });
    },
  };
  const sessions = {
    require: vi.fn<ChatSessionService["require"]>(async (actor, id) => {
      if (actor.id !== OWNER.id || id !== FIRST)
        throw new Error("Foreign session");
      return SESSION;
    }),
  };
  const verify = vi.fn(async (userId: string) => ({
    userId,
    isAdmin: false,
    permissions: [] as const,
  }));
  const router = vi.fn<AgentOperationRouter["handle"]>(async () => ({
    apiVersion: "1",
    result: { id: "synthetic", name: "Synthetic" },
  }));
  const tools = new ChatToolExecutor({
    identities: { verify },
    router: { handle: router },
  });
  return {
    provider,
    authorize,
    sessions,
    router,
    verify,
    models,
    service: new PicaApiService({ models, sessions, tools }),
    input: {
      actor: OWNER,
      userId: OWNER.id,
      sessionId: FIRST,
      agent: ASSIGNMENT,
      message: "Lies das Ticket",
      prompt: "Synthetic prompt",
      instructions: "Synthetic Pica",
    },
    controller: new AbortController(),
  };
}
