import { describe, expect, it, vi } from "vitest";

import { AgentTextExecution } from "@/backend/agents/AgentTextExecution";
import { ApiTextExecution } from "@/backend/agents/providers/ApiTextExecution";
import {
  createTextProviderRequest,
  readTextProviderResponse,
} from "@/backend/agents/providers/TextProviderPayload";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";

import { useMigratedDatabase } from "../helpers/test-database";

import type { ApiProviderId } from "@/definition/AgentConnection";
import type {
  TextExecution,
  TextExecutionInput,
} from "@/backend/agents/TextExecution";

const PROVIDERS: readonly ApiProviderId[] = [
  "openai",
  "openrouter",
  "google_ai_studio",
  "anthropic",
  "zai",
];
const CHAT = {
  choices: [{ finish_reason: "stop", message: { content: "Answer" } }],
};
const PAYLOADS: Readonly<Record<ApiProviderId, unknown>> = {
  openai: CHAT,
  openrouter: CHAT,
  zai: CHAT,
  google_ai_studio: {
    candidates: [
      { finishReason: "STOP", content: { parts: [{ text: "Answer" }] } },
    ],
  },
  anthropic: {
    stop_reason: "end_turn",
    content: [{ type: "text", text: "Answer" }],
  },
};

function input(
  provider: ApiProviderId | "codex_cli" = "openai",
  effort: string | null = null,
): TextExecutionInput {
  return {
    agent: {
      model: "models/selected",
      reasoningEffort: effort,
      connection: {
        id: "connection",
        name: "Synthetic",
        provider,
        hasApiKey: true,
        testModel: "diagnostic-default",
        reasoningEffort: null,
        cliLoggedInAt: null,
        cliAccountLabel: null,
        updatedAt: "now",
      },
    },
    prompt: "Chosen context only",
  };
}

describe("native text adapter contracts", () => {
  it.each(PROVIDERS)(
    "uses %s's real text endpoint and exact selected model/effort",
    (provider) => {
      const selected = input(provider, "medium");
      const request = createTextProviderRequest(provider, selected);
      expect(JSON.stringify(request)).toContain(selected.prompt);
      expect(JSON.stringify(request)).not.toContain("diagnostic-default");
      if (provider === "google_ai_studio") {
        expect(request.path).toBe("/models/selected:generateContent");
        expect(request.body.generationConfig).toEqual({
          maxOutputTokens: 16_384,
          thinkingConfig: { thinkingLevel: "MEDIUM" },
        });
        expect(
          createTextProviderRequest(provider, input(provider)).body
            .generationConfig,
        ).toEqual({ maxOutputTokens: 16_384 });
      } else expect(request.body.model).toBe(selected.agent.model);
      if (provider === "openai")
        expect(request.body).toMatchObject({
          store: false,
          reasoning_effort: "medium",
          max_completion_tokens: 16_384,
        });
      if (provider === "openrouter")
        expect(request.body).toMatchObject({
          provider: { allow_fallbacks: false },
          reasoning: { effort: "medium" },
        });
      if (provider === "anthropic")
        expect(request.body).toMatchObject({
          output_config: { effort: "medium" },
        });
      expect(readTextProviderResponse(provider, PAYLOADS[provider])).toBe(
        "Answer",
      );
      expect(
        createTextProviderRequest(provider, input(provider)).body,
      ).not.toHaveProperty("output_config");
    },
  );

  it.each([
    ["openai", {}],
    ["openai", { choices: [] }],
    [
      "openai",
      {
        choices: [{ finish_reason: "length", message: { content: "Partial" } }],
      },
    ],
    [
      "openai",
      { choices: [{ finish_reason: "stop", message: { content: 1 } }] },
    ],
    [
      "openai",
      {
        choices: [
          {
            finish_reason: "stop",
            message: { content: "Answer", tool_calls: [] },
          },
        ],
      },
    ],
    [
      "openai",
      {
        choices: [
          {
            finish_reason: "stop",
            message: { content: "Answer", refusal: "refused" },
          },
        ],
      },
    ],
    ["anthropic", {}],
    ["anthropic", { stop_reason: "end_turn", content: null }],
    ["anthropic", { stop_reason: "end_turn", content: [{ type: "tool_use" }] }],
    [
      "anthropic",
      {
        stop_reason: "end_turn",
        content: [{ text: "private", thought: true }],
      },
    ],
    ["google_ai_studio", {}],
    ["google_ai_studio", { candidates: [] }],
    [
      "google_ai_studio",
      {
        candidates: [
          {
            finishReason: "MAX_TOKENS",
            content: { parts: [{ text: "Partial" }] },
          },
        ],
      },
    ],
  ] as const)(
    "rejects incomplete, refusal or tool-bearing %s responses",
    (provider, payload) => {
      expect(() => readTextProviderResponse(provider, payload)).toThrow(
        "invalidOutput",
      );
    },
  );
});

describe("text HTTP transport uses A7 secrets without forwarding diagnostics", () => {
  const getDatabase = useMigratedDatabase();
  async function setup(provider: ApiProviderId = "openai") {
    const repository = new AgentConnectionRepository(getDatabase());
    const cipher = new InstanceSecretCipher(Buffer.alloc(32, 3));
    await repository.insert({
      id: "connection",
      name: "Synthetic",
      provider,
      secretEncrypted: cipher.encrypt("connection", "synthetic-key-marker"),
      testModel: null,
      actorId: "actor",
    });
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(PAYLOADS[provider]));
    const execution = new ApiTextExecution(repository, cipher, request);
    return {
      execution,
      repository,
      request,
      cipher,
      signal: new AbortController().signal,
    };
  }

  it.each(PROVIDERS)(
    "authenticates %s once with no redirects/retries and no secret in URLs/prompts",
    async (provider) => {
      const { execution, request, signal } = await setup(provider);
      expect(await execution.run(input(provider), signal)).toBe("Answer");
      expect(request).toHaveBeenCalledTimes(1);
      const [url, options] = request.mock.calls[0];
      expect(String(url)).not.toContain("synthetic-key-marker");
      expect(options?.body).not.toContain("synthetic-key-marker");
      expect(options).toMatchObject({
        method: "POST",
        signal,
        redirect: "error",
      });
    },
  );

  it("redacts a credential echoed by the provider and never returns upstream errors", async () => {
    const { execution, request, signal } = await setup();
    request.mockResolvedValueOnce(
      Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: "synthetic-key-marker" },
          },
        ],
      }),
    );
    expect(await execution.run(input(), signal)).toBe("[redacted]");
    request.mockResolvedValueOnce(
      Response.json(
        { error: { message: "synthetic-key-marker", code: 401 } },
        { status: 401 },
      ),
    );
    await expect(execution.run(input(), signal)).rejects.toThrow(
      "providerFailed",
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("bounds streamed responses, rejects empty/invalid bodies and sanitizes network/cipher errors", async () => {
    const { execution, request, repository, signal } = await setup();
    for (const response of [
      new Response(null),
      new Response("not-json"),
      new Response("x".repeat(1024 * 1024 + 1)),
    ]) {
      request.mockResolvedValueOnce(response);
      await expect(execution.run(input(), signal)).rejects.toBeInstanceOf(
        TextAssistantError,
      );
    }
    request.mockRejectedValueOnce(new Error("synthetic credential diagnostic"));
    await expect(execution.run(input(), signal)).rejects.toThrow(
      "providerFailed",
    );
    await getDatabase().execute(
      "UPDATE agent_connections SET secret_encrypted = 'invalid' WHERE id = 'connection';",
    );
    await expect(execution.run(input(), signal)).rejects.toThrow(
      "providerFailed",
    );
    vi.spyOn(repository, "findSecretEncrypted").mockResolvedValueOnce(null);
    await expect(execution.run(input(), signal)).rejects.toThrow(
      "connectionUnavailable",
    );
    await getDatabase().execute(
      "UPDATE agent_connections SET provider = 'anthropic' WHERE id = 'connection';",
    );
    await expect(execution.run(input(), signal)).rejects.toThrow(
      "connectionUnavailable",
    );
    await repository.remove("connection");
    await expect(execution.run(input(), signal)).rejects.toThrow(
      "connectionUnavailable",
    );
    await expect(execution.run(input("codex_cli"), signal)).rejects.toThrow(
      "connectionUnavailable",
    );
  });

  it("stops pre-aborted and late-aborted requests without accepting an answer", async () => {
    const { execution, request } = await setup();
    const controller = new AbortController();
    controller.abort();
    await expect(execution.run(input(), controller.signal)).rejects.toThrow(
      "providerFailed",
    );
    expect(request).not.toHaveBeenCalled();
    const late = new AbortController();
    request.mockImplementationOnce(async () => {
      late.abort();
      return Response.json(CHAT);
    });
    await expect(execution.run(input(), late.signal)).rejects.toThrow(
      "providerFailed",
    );
  });

  it("shares the operation lock and selects exactly the assigned API or CLI execution", async () => {
    const api = { run: vi.fn<TextExecution["run"]>().mockResolvedValue("API") };
    const cli = { run: vi.fn<TextExecution["run"]>().mockResolvedValue("CLI") };
    const operations = new AgentOperationRegistry();
    const execution = new AgentTextExecution(api, cli, operations);
    const signal = new AbortController().signal;
    expect(await execution.run(input(), signal)).toBe("API");
    expect(await execution.run(input("codex_cli"), signal)).toBe("CLI");
    const release = operations.acquire("connection", "write");
    await expect(execution.run(input(), signal)).rejects.toMatchObject({
      code: "check_in_progress",
    });
    release();
    expect(api.run).toHaveBeenCalledTimes(1);
    expect(cli.run).toHaveBeenCalledTimes(1);
  });
});
