import { expect, it, vi } from "vitest";

import { startAcpSession } from "./acp-harness";

vi.mock("@/backend/agents/cli/CliProcessScan", () => ({
  RUN_INSTANCE_VARIABLE: "PAGES_RUN_INSTANCE",
  readServerScope: async () => ({ earliestStart: 0 }),
  endTaggedProcesses: vi.fn(async () => ({ found: 0, remaining: 0 })),
}));

it("opts Claude plans into SDK accounting and delivers sanitized live readings before the prompt ends", async () => {
  const claudeUsage = vi.fn();
  const listener = {
    update: vi.fn(),
    prompted: vi.fn(),
    closed: vi.fn(),
    drained: vi.fn(async () => undefined),
    claudeUsage,
  };
  const started = startAcpSession(
    {
      turn: async (turn) => {
        await turn.native({
          type: "assistant",
          message: {
            id: "m1",
            model: "claude-haiku-5-5",
            content: "private",
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              cache_read_input_tokens: 1000,
              cache_creation_input_tokens: 200,
            },
          },
        });
        await turn.update({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "finished" },
        });
        await vi.waitFor(() => expect(claudeUsage).toHaveBeenCalledTimes(1));
        return "end_turn";
      },
    },
    {
      provider: "claude_code",
      model: "claude-haiku-5-5",
      reasoningEffort: "low",
      hasMcp: false,
      listener,
    },
  );
  const result = await started.session.turn;
  expect(result.failure).toBeNull();
  expect(
    started.calls.find((call) => call.method === "session/new")?.params,
  ).toMatchObject({
    _meta: {
      claudeCode: {
        emitRawSDKMessages: [{ type: "assistant" }, { type: "result" }],
      },
    },
  });
  expect(claudeUsage.mock.calls[0]?.[0]).toMatchObject({
    kind: "message",
    models: [
      {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 1000,
        cacheWriteTokens: 200,
      },
    ],
  });
  expect(JSON.stringify(claudeUsage.mock.calls)).not.toContain("private");
  await started.session.close();
});
