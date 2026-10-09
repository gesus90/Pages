import { describe, expect, it, vi } from "vitest";

import { readAgentObject } from "@/backend/agents/AgentPayload";
import { createApiProviderRegistry } from "@/backend/agents/providers/ApiProviderRegistry";
import { classifyProviderError } from "@/backend/agents/providers/ProviderErrors";
import { ProviderHttpClient } from "@/backend/agents/providers/ProviderHttpClient";
import {
  AGENT_PROVIDERS,
  MODEL_TEST_PROMPT,
  ZAI_FREE_MODEL,
} from "@/definition/AgentConnection";

import type { ApiProviderId } from "@/definition/AgentConnection";
import type { ProviderHttpTransport } from "@/backend/agents/providers/ProviderContracts";

const PROVIDERS: readonly ApiProviderId[] = [
  "openrouter",
  "openai",
  "google_ai_studio",
  "zai",
  "anthropic",
];
const CHAT = {
  choices: [
    { message: { role: "assistant", content: "OK" }, finish_reason: "stop" },
  ],
  usage: { prompt_tokens: 5, completion_tokens: 2 },
};
const AUTH: Record<ApiProviderId, unknown> = {
  openrouter: { data: { is_free_tier: false, limit_remaining: 4.2 } },
  openai: { data: [{ id: "test" }] },
  google_ai_studio: {
    models: [{ name: "models/test" }],
    nextPageToken: "more",
  },
  zai: CHAT,
  anthropic: { data: [{ id: "test" }], has_more: true },
};
const MODEL: Record<ApiProviderId, unknown> = {
  openrouter: CHAT,
  openai: CHAT,
  google_ai_studio: {
    candidates: [{ content: { parts: [{ text: "OK" }] } }],
    usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
  },
  zai: CHAT,
  anthropic: {
    type: "message",
    content: [{ type: "text", text: "OK" }],
    usage: { input_tokens: 5, output_tokens: 2 },
  },
};
const AUTH_PATHS = {
  openrouter: "/key",
  openai: "/models",
  google_ai_studio: "/models?pageSize=1000",
  zai: "/chat/completions",
  anthropic: "/models",
};

function setup(
  provider: ApiProviderId,
  payload: unknown = AUTH[provider],
  status = 200,
) {
  const request = vi
    .fn<ProviderHttpTransport>()
    .mockResolvedValue({ status, json: async () => payload });
  const adapter = createApiProviderRegistry(new ProviderHttpClient(request))[
    provider
  ];
  return { request, adapter, signal: new AbortController().signal };
}

describe.each(PROVIDERS)("%s diagnostic adapter", (provider) => {
  it("uses its authenticated endpoint, secret headers and exactly one request", async () => {
    const { adapter, request, signal } = setup(provider);
    const result = await adapter.checkAccess("key-marker", signal);
    expect(result.ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe(AGENT_PROVIDERS[provider].endpoint + AUTH_PATHS[provider]);
    expect(url).not.toContain("key-marker");
    expect(options).toMatchObject({
      signal,
      redirect: "error",
      method: provider === "zai" ? "POST" : "GET",
    });
    if (provider === "google_ai_studio")
      expect(options.headers["x-goog-api-key"]).toBe("key-marker");
    else if (provider === "anthropic")
      expect(options.headers).toMatchObject({
        "x-api-key": "key-marker",
        "anthropic-version": "2023-06-01",
      });
    else expect(options.headers.Authorization).toBe("Bearer key-marker");
    expect(JSON.stringify(result)).not.toContain("key-marker");
    if (provider === "zai")
      expect(JSON.parse(options.body ?? "")).toMatchObject({
        model: ZAI_FREE_MODEL,
        max_tokens: 1,
        thinking: { type: "disabled" },
      });
  });

  it("sends the fixed prompt with at most 16 tokens and records only measurements", async () => {
    const { adapter, request, signal } = setup(provider, MODEL[provider]);
    expect(
      await adapter.runModelTest(
        { apiKey: "key-marker", model: "test-model", reasoningEffort: null },
        signal,
      ),
    ).toMatchObject({
      ok: true,
      detail: { model: "test-model", inputTokens: 5, outputTokens: 2 },
    });
    const [url, options] = request.mock.calls[0];
    const body: unknown = JSON.parse(options.body ?? "");
    expect(options.method).toBe("POST");
    expect(options.body).not.toContain("key-marker");
    expect(options.body).toContain(MODEL_TEST_PROMPT);
    if (provider === "google_ai_studio") {
      expect(url.endsWith("/models/test-model:generateContent")).toBe(true);
      expect(body).toEqual({
        contents: [{ parts: [{ text: MODEL_TEST_PROMPT }] }],
        generationConfig: { maxOutputTokens: 16 },
      });
    } else if (provider === "openai")
      expect(body).toMatchObject({
        max_completion_tokens: 16,
        model: "test-model",
      });
    else expect(body).toMatchObject({ max_tokens: 16, model: "test-model" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("maps the entire HTTP failure matrix without retaining or logging raw errors", async () => {
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const warnLog = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    for (const [status, errorCode] of [
      [401, "provider_auth_failed"],
      [402, "provider_quota_exhausted"],
      [403, "provider_permission_denied"],
      [404, "provider_model_not_found"],
      [429, "provider_rate_limited"],
      [500, "provider_unavailable"],
      [502, "provider_unavailable"],
      [503, "provider_unavailable"],
      [504, "provider_unavailable"],
      [529, "provider_unavailable"],
      [400, "provider_request_rejected"],
      [422, "provider_request_rejected"],
      [302, "provider_bad_response"],
    ] as const) {
      const { adapter, request, signal } = setup(
        provider,
        { error: { message: "key-marker raw-private-response" } },
        status,
      );
      const result = await adapter.checkAccess("key-marker", signal);
      expect(result).toMatchObject({ ok: false, errorCode });
      expect(JSON.stringify(result)).not.toMatch(
        /key-marker|raw-private-response/,
      );
      expect(request).toHaveBeenCalledTimes(1);
    }
    expect(errorLog).not.toHaveBeenCalled();
    expect(warnLog).not.toHaveBeenCalled();
  });

  it("rejects malformed successes, network errors and cancelled requests without retries", async () => {
    const { adapter, request, signal } = setup(provider, {});
    await expect(
      adapter.checkAccess("key-marker", signal),
    ).resolves.toMatchObject({ errorCode: "provider_bad_response" });
    await expect(
      adapter.runModelTest(
        { apiKey: "key-marker", model: "test", reasoningEffort: null },
        signal,
      ),
    ).resolves.toMatchObject({ errorCode: "provider_bad_response" });
    request.mockRejectedValueOnce(new Error("DNS key-marker"));
    await expect(
      adapter.checkAccess("key-marker", signal),
    ).resolves.toMatchObject({ errorCode: "provider_unreachable" });
    const aborted = AbortSignal.abort();
    await expect(
      adapter.checkAccess("key-marker", aborted),
    ).resolves.toMatchObject({ errorCode: "check_timeout" });
    expect(request).toHaveBeenCalledTimes(3);
  });
});

describe("provider payloads and transport", () => {
  it("sends a saved reasoning effort in each provider's documented field", async () => {
    const fields = {
      openrouter: { reasoning: { effort: "high" } },
      anthropic: { output_config: { effort: "high" } },
    } as const;
    for (const provider of ["openrouter", "anthropic"] as const) {
      const { adapter, request, signal } = setup(provider, MODEL[provider]);
      await adapter.runModelTest(
        { apiKey: "key-marker", model: "test-model", reasoningEffort: "high" },
        signal,
      );
      expect(JSON.parse(request.mock.calls[0][1].body ?? "")).toMatchObject(
        fields[provider],
      );
      // Without a saved effort the provider default applies.
      await adapter.runModelTest(
        { apiKey: "key-marker", model: "test-model", reasoningEffort: null },
        signal,
      );
      const plain = JSON.parse(request.mock.calls[1][1].body ?? "");
      expect(plain).not.toHaveProperty("reasoning");
      expect(plain).not.toHaveProperty("output_config");
    }
  });

  it("maps provider-specific error codes, including errors inside HTTP 200", () => {
    for (const code of [1000, 1001, 1002, 1003, 1004, 1005])
      expect(classifyProviderError(400, { error: { code } })).toBe(
        "provider_auth_failed",
      );
    const cases = [
      ["API_KEY_INVALID", "provider_auth_failed"],
      ["1113", "provider_quota_exhausted"],
      ["insufficient_quota", "provider_quota_exhausted"],
      ["billing_hard_limit_reached", "provider_quota_exhausted"],
      ["billing_not_active", "provider_quota_exhausted"],
      ["billing_error", "provider_quota_exhausted"],
      ["1220", "provider_permission_denied"],
      ["1211", "provider_model_not_found"],
      ["model_not_found", "provider_model_not_found"],
      ["1302", "provider_rate_limited"],
      ["1305", "provider_rate_limited"],
      [429, "provider_rate_limited"],
      [401, "provider_auth_failed"],
      [500, "provider_unavailable"],
      [400, "provider_request_rejected"],
    ] as const;
    for (const [code, expected] of cases)
      expect(classifyProviderError(200, { error: { code } })).toBe(expected);
    expect(
      classifyProviderError(429, { error: { type: "insufficient_quota" } }),
    ).toBe("provider_quota_exhausted");
    expect(
      classifyProviderError(400, {
        error: { details: [{ reason: "API_KEY_INVALID" }, null] },
      }),
    ).toBe("provider_auth_failed");
    expect(
      classifyProviderError(400, { error: { status: "FAILED_PRECONDITION" } }),
    ).toBe("provider_request_rejected");
    expect(classifyProviderError(599, null)).toBe("provider_unavailable");
    expect(classifyProviderError(100, null)).toBe("provider_bad_response");
    expect(classifyProviderError(200, { error: { message: "raw" } })).toBe(
      "provider_bad_response",
    );
    expect(classifyProviderError(204, {})).toBeNull();
    for (const invalid of [undefined, null, [], "raw"])
      expect(readAgentObject(invalid)).toEqual({});
  });

  it("rejects invalid JSON safely, preserving HTTP errors and timeouts", async () => {
    const { adapter, request, signal } = setup("openai");
    request.mockResolvedValueOnce({
      status: 200,
      json: async () => {
        throw new Error("raw-marker");
      },
    });
    expect(await adapter.checkAccess("key", signal)).toMatchObject({
      errorCode: "provider_bad_response",
    });
    request.mockResolvedValueOnce({
      status: 401,
      json: async () => {
        throw new Error("raw-marker");
      },
    });
    expect(await adapter.checkAccess("key", signal)).toMatchObject({
      errorCode: "provider_auth_failed",
    });
    const controller = new AbortController();
    request.mockResolvedValueOnce({
      status: 200,
      json: async () => {
        controller.abort();
        throw new Error("raw-marker");
      },
    });
    expect(await adapter.checkAccess("key", controller.signal)).toMatchObject({
      errorCode: "check_timeout",
    });
    const afterBody = new AbortController();
    request.mockResolvedValueOnce({
      status: 200,
      json: async () => {
        afterBody.abort();
        return AUTH.openai;
      },
    });
    expect(await adapter.checkAccess("key", afterBody.signal)).toMatchObject({
      errorCode: "check_timeout",
    });
  });

  it("aborts the injected transport at the deadline and wires native fetch by default", async () => {
    const transport = vi.fn<ProviderHttpTransport>().mockImplementation(
      async (_, options) =>
        new Promise((_, reject) => {
          options.signal.addEventListener(
            "abort",
            () => reject(new Error("timeout with secret")),
            { once: true },
          );
        }),
    );
    const adapter = createApiProviderRegistry(
      new ProviderHttpClient(transport),
    ).openai;
    expect(
      await adapter.checkAccess("key", AbortSignal.timeout(5)),
    ).toMatchObject({ errorCode: "check_timeout" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(AUTH.openai))),
    );
    expect(
      await createApiProviderRegistry().openai.checkAccess(
        "fake-key",
        new AbortController().signal,
      ),
    ).toMatchObject({ ok: true });
  });

  it("handles empty listings, pagination and validates model list entries", async () => {
    for (const provider of ["openai", "anthropic"] as const) {
      const { adapter, request, signal } = setup(provider, { data: [] });
      expect(await adapter.checkAccess("key", signal)).toMatchObject({
        ok: true,
        detail: { modelCount: 0 },
      });
      request.mockResolvedValueOnce({
        status: 200,
        json: async () => ({ data: [{}] }),
      });
      expect(await adapter.checkAccess("key", signal)).toMatchObject({
        errorCode: "provider_bad_response",
      });
    }
    const { adapter, request, signal } = setup("google_ai_studio", {
      models: [],
    });
    expect(await adapter.checkAccess("key", signal)).toMatchObject({
      ok: true,
      detail: { modelCount: 0, hasMoreModels: false },
    });
    request.mockResolvedValueOnce({
      status: 200,
      json: async () => ({ models: [], nextPageToken: "" }),
    });
    expect(await adapter.checkAccess("key", signal)).toMatchObject({
      ok: true,
      detail: { hasMoreModels: false },
    });
    request.mockResolvedValueOnce({
      status: 200,
      json: async () => ({ models: [{}] }),
    });
    expect(await adapter.checkAccess("key", signal)).toMatchObject({
      errorCode: "provider_bad_response",
    });
  });

  it("accepts token-limit truncation but refuses invalid completion structures", async () => {
    const { adapter, request, signal } = setup("openai", {
      choices: [
        {
          message: { role: "assistant", content: null },
          finish_reason: "length",
        },
      ],
    });
    expect(
      await adapter.runModelTest(
        { apiKey: "key", model: "test", reasoningEffort: null },
        signal,
      ),
    ).toMatchObject({ ok: true });
    for (const payload of [
      { choices: [] },
      { choices: [{ message: { role: "user", content: "OK" } }] },
      {
        choices: [
          {
            message: { role: "assistant", content: null },
            finish_reason: "stop",
          },
        ],
      },
    ]) {
      request.mockResolvedValueOnce({ status: 200, json: async () => payload });
      expect(
        await adapter.runModelTest(
          { apiKey: "key", model: "test", reasoningEffort: null },
          signal,
        ),
      ).toMatchObject({ errorCode: "provider_bad_response" });
    }
    const google = setup("google_ai_studio", {
      candidates: [{ finishReason: "MAX_TOKENS" }],
    });
    expect(
      await google.adapter.runModelTest(
        { apiKey: "key", model: "models/test?query", reasoningEffort: null },
        signal,
      ),
    ).toMatchObject({ ok: true });
    expect(
      google.request.mock.calls[0][0].endsWith(
        "/models/test%3Fquery:generateContent",
      ),
    ).toBe(true);
    for (const payload of [
      { candidates: [] },
      { candidates: [{ finishReason: "SAFETY" }] },
    ]) {
      google.request.mockResolvedValueOnce({
        status: 200,
        json: async () => payload,
      });
      expect(
        await google.adapter.runModelTest(
          { apiKey: "key", model: "test", reasoningEffort: null },
          signal,
        ),
      ).toMatchObject({ errorCode: "provider_bad_response" });
    }
    const anthropic = setup("anthropic", {
      type: "message",
      content: "invalid",
    });
    expect(
      await anthropic.adapter.runModelTest(
        { apiKey: "key", model: "test", reasoningEffort: null },
        signal,
      ),
    ).toMatchObject({ errorCode: "provider_bad_response" });
  });
});

describe("Google reasoning transport", () => {
  it("passes an explicitly selected level as the documented thinkingLevel enum value, without a budget mapping or replacement", async () => {
    const { adapter, request, signal } = setup(
      "google_ai_studio",
      MODEL.google_ai_studio,
    );
    await adapter.runModelTest(
      {
        apiKey: "synthetic",
        model: "models/catalog-model",
        reasoningEffort: "minimal",
      },
      signal,
    );
    expect(JSON.parse(request.mock.calls[0]?.[1]?.body ?? "{}")).toMatchObject({
      generationConfig: {
        maxOutputTokens: 16,
        thinkingConfig: { thinkingLevel: "MINIMAL" },
      },
    });
    expect(request).toHaveBeenCalledOnce();
  });
});
