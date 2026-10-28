import { beforeEach, expect, it, vi } from "vitest";

import { ApiTextExecution } from "@/backend/agents/providers/ApiTextExecution";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AgentProviderError } from "@/backend/error/AgentProviderError";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { logCaughtError } from "@/backend/logging/Logger";

import { textInput } from "../parsers/text-provider-input";

import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { TextExecutionInput } from "@/backend/agents/TextExecution";

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
}));

const API_KEY = "synthetic-key";
const CIPHER = new InstanceSecretCipher(Buffer.alloc(32, 7));

interface ExecutionFixture {
  readonly connection?: AgentConnectionRecord | null;
  readonly encrypted?: string | null;
  readonly request?: typeof fetch;
}

function completion(content: string): Response {
  return Response.json({
    choices: [{ finish_reason: "stop", message: { content } }],
  });
}

function execution(fixture: ExecutionFixture = {}): ApiTextExecution {
  const input = textInput();
  return new ApiTextExecution(
    {
      find: async () =>
        fixture.connection === undefined
          ? input.agent.connection
          : fixture.connection,
      findSecretEncrypted: async (connectionId) =>
        fixture.encrypted === undefined
          ? CIPHER.encrypt(connectionId, API_KEY)
          : fixture.encrypted,
    },
    CIPHER,
    fixture.request ?? vi.fn<typeof fetch>(async () => completion("ok")),
  );
}

function run(
  fixture: ExecutionFixture,
  input: TextExecutionInput = textInput(),
  signal: AbortSignal = new AbortController().signal,
): Promise<string> {
  return execution(fixture).run(input, signal);
}

function failingStatus(status: number, body: BodyInit | null): typeof fetch {
  return vi.fn<typeof fetch>(async () => new Response(body, { status }));
}

beforeEach(() => {
  vi.mocked(logCaughtError).mockClear();
});

it("posts to the fixed endpoint and redacts the key from the answer", async () => {
  const request = vi.fn<typeof fetch>(async () =>
    completion(`echo ${API_KEY}`),
  );
  expect(await run({ request })).toBe("echo [redacted]");
  const headers: unknown = expect.objectContaining({
    Authorization: `Bearer ${API_KEY}`,
  });
  expect(request).toHaveBeenCalledWith(
    "https://api.openai.com/v1/chat/completions",
    expect.objectContaining({ method: "POST", redirect: "error", headers }),
  );
});

it("refuses CLI connections and connections that changed or disappeared", async () => {
  const input = textInput();
  const cliInput: TextExecutionInput = {
    ...input,
    agent: {
      ...input.agent,
      connection: { ...input.agent.connection, provider: "codex_cli" },
    },
  };
  const unavailable = new AgentExecutionError("connectionUnavailable");
  await expect(run({}, cliInput)).rejects.toEqual(unavailable);
  await expect(run({ connection: null })).rejects.toEqual(unavailable);
  await expect(
    run({ connection: { ...input.agent.connection, provider: "zai" } }),
  ).rejects.toEqual(unavailable);
});

it("treats a missing or undecryptable key as an unusable connection", async () => {
  const unavailable = new AgentExecutionError("connectionUnavailable");
  await expect(run({ encrypted: null })).rejects.toEqual(unavailable);
  await expect(run({ encrypted: "not-a-ciphertext" })).rejects.toEqual(
    unavailable,
  );
  expect(logCaughtError).toHaveBeenCalledWith(
    "ApiTextExecution",
    expect.anything(),
  );
});

it("maps rate limits to retryable provider errors with their reset time", async () => {
  const request = vi.fn<typeof fetch>(async () =>
    Response.json(
      { error: { code: "rate_limit", resetAt: "2026-11-01T00:00:00Z" } },
      { status: 429 },
    ),
  );
  const failure = await run({ request }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(AgentProviderError);
  expect(failure).toMatchObject({
    failure: {
      code: "provider_rate_limited",
      resetAt: "2026-11-01T00:00:00.000Z",
    },
  });
});

it("tolerates an empty error body and still classifies the status", async () => {
  await expect(
    run({ request: failingStatus(503, null) }),
  ).rejects.toMatchObject({ failure: { code: "provider_unavailable" } });
});

it("rejects non-retryable provider errors with their own code", async () => {
  await expect(run({ request: failingStatus(401, "{}") })).rejects.toEqual(
    new AgentError("provider_auth_failed"),
  );
});

it.each([
  ["an empty success body", null],
  ["an unparsable success body", "{not json"],
  ["an oversized success body", "x".repeat(1024 * 1024 + 1)],
])("refuses %s as invalid output", async (label, body) => {
  await expect(run({ request: failingStatus(200, body) })).rejects.toEqual(
    new AgentExecutionError("invalidOutput"),
  );
});

it("reports a network failure as an unreachable provider", async () => {
  const request = vi.fn<typeof fetch>(async () => {
    throw new TypeError("fetch failed");
  });
  const failure = await run({ request }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(AgentProviderError);
  expect(failure).toMatchObject({
    failure: { code: "provider_unreachable", resetAt: null },
  });
});

it("propagates the abort reason when the run is cancelled", async () => {
  const controller = new AbortController();
  const request = vi.fn<typeof fetch>(async () => {
    controller.abort(new Error("cancelled"));
    return completion("late");
  });
  await expect(
    run({ request }, textInput(), controller.signal),
  ).rejects.toThrow("cancelled");
});

it("propagates the abort reason when the transport fails after a cancel", async () => {
  const controller = new AbortController();
  const request = vi.fn<typeof fetch>(async () => {
    controller.abort(new Error("stopped"));
    throw new TypeError("aborted");
  });
  await expect(
    run({ request }, textInput(), controller.signal),
  ).rejects.toThrow("stopped");
});
