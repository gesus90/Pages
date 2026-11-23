import { describe, expect, it, vi } from "vitest";

import { ApiTextExecution } from "@/backend/agents/providers/ApiTextExecution";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { AgentProviderError } from "@/backend/error/AgentProviderError";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";

import type { TextExecutionInput } from "@/backend/agents/TextExecution";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { AgentProviderId } from "@/definition/AgentConnection";

const cipher = new InstanceSecretCipher(Buffer.alloc(32, 7));
const encryptedKey = cipher.encrypt("c1", "sk-secret");

function record(provider: AgentProviderId = "openai"): AgentConnectionRecord {
  return {
    isActive: true,
    id: "c1",
    name: "c",
    provider,
    hasApiKey: true,
    testModel: null,
    reasoningEffort: null,
    cliLoggedInAt: null,
    cliAccountLabel: null,
    updatedAt: "now",
  };
}

function input(
  provider: AgentProviderId = "openai",
  overrides: Partial<TextExecutionInput> = {},
): TextExecutionInput {
  return {
    agent: { connection: record(provider), model: "m", reasoningEffort: null },
    userId: "u",
    prompt: "hi",
    ...overrides,
  };
}

function repository(
  options: {
    current?: ReturnType<typeof record> | null;
    secret?: string | null;
  } = {},
): Pick<AgentConnectionRepository, "find" | "findSecretEncrypted"> {
  const { current = record(), secret = encryptedKey } = options;
  return {
    find: vi.fn(() => Promise.resolve(current)),
    findSecretEncrypted: vi.fn(() => Promise.resolve(secret)),
  };
}

function completion(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content } }],
    }),
    { status },
  );
}

function executor(
  response: Response | Error,
  repo = repository(),
): ApiTextExecution {
  return new ApiTextExecution(
    repo,
    cipher,
    vi.fn(() =>
      response instanceof Error
        ? Promise.reject(response)
        : Promise.resolve(response),
    ),
  );
}

const live = (): AbortSignal => new AbortController().signal;

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.catch((caught: unknown) => caught);
}

describe("ApiTextExecution.run", () => {
  it("returns the answer and redacts the key", async () => {
    const text = await executor(completion("key sk-secret!")).run(
      input(),
      live(),
    );
    expect(text).toBe("key [redacted]!");
  });

  it("posts to the provider with authentication headers", async () => {
    const request = vi.fn(() => Promise.resolve(completion("ok")));
    await new ApiTextExecution(repository(), cipher, request).run(
      input(),
      live(),
    );
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining("/chat/completions"),
      expect.objectContaining({ method: "POST", redirect: "error" }),
    );
  });

  it("uses the global fetch by default", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(completion("ok"));
    await new ApiTextExecution(repository(), cipher).run(input(), live());
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("reads ticket assets through the provided reader", async () => {
    const readTicketAssets = vi.fn(() => Promise.resolve([]));
    await executor(completion("ok")).run(
      input("openai", {
        ticketInputs: [
          {
            parameter: "p",
            ticket: {
              id: "t",
              key: "K-1",
              title: "T",
              description: "",
              assets: [],
              markdown: "",
              version: "1",
            },
          },
        ],
        readTicketAssets,
      }),
      live(),
    );
    expect(readTicketAssets).toHaveBeenCalledOnce();
  });

  it("rejects non-API providers", async () => {
    const error = await failure(
      executor(completion("x")).run(input("codex_cli"), live()),
    );
    expect(error).toBeInstanceOf(AgentExecutionError);
  });

  it("rejects a missing or changed connection", async () => {
    for (const current of [null, record("anthropic")]) {
      const error = await failure(
        executor(completion("x"), repository({ current })).run(input(), live()),
      );
      expect(error).toBeInstanceOf(AgentExecutionError);
    }
  });

  it("rejects a missing or undecryptable key", async () => {
    for (const secret of [null, "garbage"]) {
      const error = await failure(
        executor(completion("x"), repository({ secret })).run(input(), live()),
      );
      expect(error).toBeInstanceOf(AgentExecutionError);
    }
  });
});

describe("ApiTextExecution.run failures", () => {
  it("maps a plan-retry status to a provider error with reset time", async () => {
    const error = await failure(
      executor(
        new Response("{}", { status: 429, headers: { "retry-after": "5" } }),
      ).run(input(), live()),
    );
    expect(error).toBeInstanceOf(AgentProviderError);
    expect((error as AgentProviderError).failure.code).toBe(
      "provider_rate_limited",
    );
  });

  it("maps other classified statuses to an AgentError", async () => {
    const error = await failure(
      executor(new Response("{}", { status: 401 })).run(input(), live()),
    );
    expect(error).toBeInstanceOf(AgentError);
    expect(error).not.toBeInstanceOf(AgentProviderError);
  });

  it("classifies an unreadable error body by status", async () => {
    const error = await failure(
      executor(new Response("not json", { status: 503 })).run(input(), live()),
    );
    expect(error).toBeInstanceOf(AgentProviderError);
  });

  it("fails with invalid output for an unreadable success body", async () => {
    const error = await failure(
      executor(new Response("not json", { status: 200 })).run(input(), live()),
    );
    expect(error).toBeInstanceOf(AgentExecutionError);
  });

  it("fails when the response has no body", async () => {
    const error = await failure(
      executor(new Response(null, { status: 200 })).run(input(), live()),
    );
    expect(error).toBeInstanceOf(AgentExecutionError);
  });

  it("refuses an oversized response", async () => {
    const error = await failure(
      executor(new Response("x".repeat(1024 * 1024 + 1), { status: 200 })).run(
        input(),
        live(),
      ),
    );
    expect(error).toBeInstanceOf(AgentExecutionError);
  });

  it("reports an unreachable provider on a transport failure", async () => {
    const error = await failure(
      executor(new Error("down")).run(input(), live()),
    );
    expect(error).toBeInstanceOf(AgentProviderError);
    expect((error as AgentProviderError).failure.code).toBe(
      "provider_unreachable",
    );
  });

  it("rethrows the abort reason when the signal aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    const error = await failure(
      executor(completion("x")).run(input(), controller.signal),
    );
    expect(error).toEqual(new Error("stop"));
  });

  it("falls back to unreachable when abort happens in flight", async () => {
    const controller = new AbortController();
    const request = vi.fn(() => {
      controller.abort(new Error("late"));
      return Promise.reject(new Error("aborted"));
    });
    const error = await failure(
      new ApiTextExecution(repository(), cipher, request).run(
        input(),
        controller.signal,
      ),
    );
    expect(error).toEqual(new Error("late"));
  });
});
