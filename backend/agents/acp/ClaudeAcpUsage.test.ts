import { beforeEach, expect, it, vi } from "vitest";

import {
  readClaudeSdkUsage,
  registerClaudeUsage,
} from "@/backend/agents/acp/ClaudeAcpUsage";
import { logCaughtError } from "@/backend/logging/Logger";

import type { client as acpClient } from "@agentclientprotocol/sdk";
import type { AcpSessionContext } from "@/backend/agents/acp/AcpSessionContracts";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

function result(modelUsage: Record<string, unknown>): {
  sessionId: string;
  message: unknown;
} {
  return {
    sessionId: "s1",
    message: { type: "result", uuid: "u1", modelUsage },
  };
}

it("sums the models of a session total after canonicalizing their names", () => {
  const observation = readClaudeSdkUsage(
    result({
      "claude-sonnet-4-5-20250929": {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadInputTokens: 3,
        cacheCreationInputTokens: 4,
      },
      "claude-sonnet-4-5": { inputTokens: 10 },
      "claude-haiku-4-5": { inputTokens: 5 },
    }),
  );
  expect(observation).toEqual({
    sessionId: "s1",
    id: "u1",
    kind: "total",
    models: [
      {
        model: "claude-sonnet-4-5",
        inputTokens: 11,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
      },
      {
        model: "claude-haiku-4-5",
        inputTokens: 5,
        outputTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
      },
    ],
  });
});

it("reads nothing from a total without any counter", () => {
  expect(readClaudeSdkUsage(result({ "claude-sonnet-4-5": {} }))).toBeNull();
});

function assistant(usage: Record<string, unknown>): {
  sessionId: string;
  message: unknown;
} {
  return {
    sessionId: "s1",
    message: {
      type: "assistant",
      message: { id: "m1", model: "claude-opus-4-1", usage },
    },
  };
}

it("reads the usage of one assistant message", () => {
  expect(
    readClaudeSdkUsage(
      assistant({
        input_tokens: 1,
        output_tokens: 2,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 4,
      }),
    ),
  ).toEqual({
    sessionId: "s1",
    id: "m1",
    kind: "message",
    models: [
      {
        model: "claude-opus-4-1",
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
      },
    ],
  });
});

it("fills missing counters of a message with null", () => {
  expect(
    readClaudeSdkUsage(assistant({ input_tokens: 7 }))?.models[0],
  ).toMatchObject({ outputTokens: null, cacheReadTokens: null });
});

it("reads nothing from a message without counters or from another message", () => {
  expect(readClaudeSdkUsage(assistant({}))).toBeNull();
  expect(
    readClaudeSdkUsage({ sessionId: "s1", message: { type: "user" } }),
  ).toBeNull();
});

type Handler = (message: { params: unknown }) => Promise<void>;

interface Setup {
  readonly context: AcpSessionContext;
  readonly handler: Handler | null;
  readonly claudeUsage: ReturnType<typeof vi.fn>;
  readonly drained: ReturnType<typeof vi.fn>;
  readonly handled: ReturnType<typeof vi.fn>;
  readonly failed: ReturnType<typeof vi.fn>;
}

function register(
  options: {
    provider?: string;
    listener?: boolean;
    session?: string | null;
    withDrained?: boolean;
    withHandled?: boolean;
  } = {},
): Setup {
  let handler: Handler | null = null;
  const client = {
    onNotification: (...parameters: [string, unknown, Handler]) => {
      handler = parameters[2];
    },
  } as unknown as ReturnType<typeof acpClient>;
  const claudeUsage = vi.fn();
  const drained = vi.fn(() => Promise.resolve());
  const handled = vi.fn();
  const failed = vi.fn();
  const listener =
    options.listener === false
      ? {}
      : {
          claudeUsage,
          ...(options.withDrained === false ? {} : { drained }),
        };
  const context = {
    driver: { provider: options.provider ?? "claude_code" },
    listener,
    ...(options.withHandled === false ? {} : { notificationHandled: handled }),
  } as unknown as AcpSessionContext;
  registerClaudeUsage(client, context, {
    session: () => options.session ?? null,
    failed,
  });
  return { context, handler, claudeUsage, drained, handled, failed };
}

const ENVELOPE = assistant({ input_tokens: 1 });

beforeEach(() => {
  vi.mocked(logCaughtError).mockReset();
});

it("registers only for a Claude session with a usage listener", () => {
  expect(register({ provider: "codex_cli" }).handler).toBeNull();
  expect(register({ listener: false }).handler).toBeNull();
});

it("reports the observation, waits for the journal and releases the read", async () => {
  const setup = register({ session: "s1" });
  await setup.handler?.({ params: ENVELOPE });
  expect(setup.claudeUsage).toHaveBeenCalledTimes(1);
  expect(setup.drained).toHaveBeenCalledTimes(1);
  expect(setup.handled).toHaveBeenCalledTimes(1);
});

it("reports before the session id is known and tolerates missing callbacks", async () => {
  const setup = register({ withDrained: false, withHandled: false });
  await setup.handler?.({ params: ENVELOPE });
  expect(setup.claudeUsage).toHaveBeenCalledTimes(1);
});

it("skips a notification of another session", async () => {
  const setup = register({ session: "other" });
  await setup.handler?.({ params: ENVELOPE });
  expect(setup.claudeUsage).not.toHaveBeenCalled();
  expect(setup.handled).toHaveBeenCalledTimes(1);
});

it("skips a notification without usage but still drains", async () => {
  const setup = register();
  await setup.handler?.({
    params: { sessionId: "s1", message: { type: "user" } },
  });
  expect(setup.claudeUsage).not.toHaveBeenCalled();
  expect(setup.drained).toHaveBeenCalledTimes(1);
});

it("fails the session when the listener throws", async () => {
  const setup = register();
  setup.claudeUsage.mockImplementation(() => {
    throw new Error("listener");
  });
  await setup.handler?.({ params: ENVELOPE });
  expect(logCaughtError).toHaveBeenCalled();
  expect(setup.failed).toHaveBeenCalledTimes(1);
  expect(setup.handled).toHaveBeenCalledTimes(1);
});

it("tolerates a listener that left the session before the notification", async () => {
  const setup = register();
  Object.assign(setup.context, { listener: undefined });
  await setup.handler?.({ params: ENVELOPE });
  expect(setup.claudeUsage).not.toHaveBeenCalled();
  expect(setup.handled).toHaveBeenCalledTimes(1);
});

it("fills a missing input counter of a message with null", () => {
  expect(
    readClaudeSdkUsage(assistant({ output_tokens: 7 }))?.models[0],
  ).toMatchObject({ inputTokens: null, outputTokens: 7 });
});
