import { expect, it, vi } from "vitest";

import { createApiProviderRegistry } from "@/backend/agents/providers/ApiProviderRegistry";
import { ProviderHttpClient } from "@/backend/agents/providers/ProviderHttpClient";
import { geminiThinkingLevel } from "@/backend/agents/providers/GoogleAiStudioProvider";
import { MODEL_TEST_PROMPT } from "@/definition/AgentConnection";

import type {
  ModelTestRequest,
  ProviderHttpOptions,
  ProviderHttpTransport,
} from "@/backend/agents/providers/ProviderContracts";

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

interface FakeProvider {
  readonly registry: ReturnType<typeof createApiProviderRegistry>;
  readonly transport: ReturnType<typeof vi.fn<ProviderHttpTransport>>;
}

const SIGNAL = new AbortController().signal;

function providerAnswering(payload: unknown): FakeProvider {
  const transport = vi.fn<ProviderHttpTransport>(async () => ({
    status: 200,
    json: async () => payload,
  }));
  return {
    registry: createApiProviderRegistry(new ProviderHttpClient(transport)),
    transport,
  };
}

function modelTest(fields: Partial<ModelTestRequest> = {}): ModelTestRequest {
  return {
    apiKey: "synthetic-key",
    model: "model-1",
    reasoningEffort: null,
    ...fields,
  };
}

function sentRequest(fake: FakeProvider): {
  readonly url: string;
  readonly options: ProviderHttpOptions;
  readonly body: unknown;
} {
  const call = fake.transport.mock.calls[0];
  if (!call) throw new Error("No request was sent");
  const body: unknown =
    call[1].body === undefined ? undefined : JSON.parse(call[1].body);
  return { url: call[0], options: call[1], body };
}

it("wires every API provider, also with its default transport", () => {
  expect(Object.keys(createApiProviderRegistry()).sort()).toEqual([
    "anthropic",
    "google_ai_studio",
    "openai",
    "openrouter",
    "zai",
  ]);
});

it("checks OpenAI access through the model list", async () => {
  const fake = providerAnswering({ data: [{ id: "gpt" }] });
  expect(
    await fake.registry.openai.checkAccess("synthetic-key", SIGNAL),
  ).toEqual({
    ok: true,
    detail: { modelCount: 1, endpoint: "api.openai.com" },
  });
  expect(sentRequest(fake).url).toBe("https://api.openai.com/v1/models");
});

it("tests an OpenAI model with a 16-token completion budget", async () => {
  const fake = providerAnswering({
    choices: [{ message: { role: "assistant", content: "ok" } }],
  });
  expect(
    await fake.registry.openai.runModelTest(modelTest(), SIGNAL),
  ).toMatchObject({ ok: true, detail: { model: "model-1" } });
  expect(sentRequest(fake).body).toEqual({
    model: "model-1",
    messages: [{ role: "user", content: MODEL_TEST_PROMPT }],
    max_completion_tokens: 16,
  });
});

it("checks OpenRouter access through the key status only", async () => {
  const fake = providerAnswering({
    data: { is_free_tier: true, limit_remaining: 3, label: "secret label" },
  });
  expect(
    await fake.registry.openrouter.checkAccess("synthetic-key", SIGNAL),
  ).toEqual({
    ok: true,
    detail: { limitRemaining: 3, isFreeTier: true, endpoint: "openrouter.ai" },
  });
  expect(
    await providerAnswering({ data: {} }).registry.openrouter.checkAccess(
      "synthetic-key",
      SIGNAL,
    ),
  ).toMatchObject({ ok: false, errorCode: "provider_bad_response" });
});

it("passes the OpenRouter reasoning effort only when the catalog lists one", async () => {
  const answer = { choices: [{ message: { role: "assistant", content: "" } }] };
  const plain = providerAnswering(answer);
  await plain.registry.openrouter.runModelTest(modelTest(), SIGNAL);
  expect(sentRequest(plain).body).not.toHaveProperty("reasoning");
  const reasoning = providerAnswering(answer);
  expect(
    await reasoning.registry.openrouter.runModelTest(
      modelTest({ reasoningEffort: "high" }),
      SIGNAL,
    ),
  ).toMatchObject({ ok: true });
  expect(sentRequest(reasoning).body).toMatchObject({
    max_tokens: 16,
    reasoning: { effort: "high" },
  });
});

it("tests a z.ai model on the saved account endpoint with thinking disabled", async () => {
  const fake = providerAnswering({
    choices: [{ message: { role: "assistant", content: "ok" } }],
  });
  expect(
    await fake.registry.zai.runModelTest(
      modelTest({ zaiAccountType: "coding-plan" }),
      SIGNAL,
    ),
  ).toMatchObject({ ok: true });
  expect(sentRequest(fake).url).toBe(
    "https://api.z.ai/api/coding/paas/v4/chat/completions",
  );
  expect(sentRequest(fake).body).toMatchObject({
    max_tokens: 16,
    thinking: { type: "disabled" },
  });
});

it("checks Anthropic access and sends the versioned key header", async () => {
  const fake = providerAnswering({ data: [{ id: "claude" }] });
  expect(
    await fake.registry.anthropic.checkAccess("synthetic-key", SIGNAL),
  ).toMatchObject({ ok: true, detail: { modelCount: 1 } });
  expect(sentRequest(fake).options.headers).toMatchObject({
    "x-api-key": "synthetic-key",
  });
});

it("tests an Anthropic model and reads native message usage", async () => {
  const fake = providerAnswering({
    type: "message",
    content: [],
    usage: { input_tokens: 4, output_tokens: 2 },
  });
  expect(
    await fake.registry.anthropic.runModelTest(
      modelTest({ reasoningEffort: "low" }),
      SIGNAL,
    ),
  ).toMatchObject({
    ok: true,
    detail: { model: "model-1", inputTokens: 4, outputTokens: 2 },
  });
  expect(sentRequest(fake).body).toMatchObject({
    max_tokens: 16,
    output_config: { effort: "low" },
  });
  const plain = providerAnswering({ type: "error", content: [] });
  expect(
    await plain.registry.anthropic.runModelTest(modelTest(), SIGNAL),
  ).toMatchObject({ ok: false, errorCode: "provider_bad_response" });
  expect(sentRequest(plain).body).not.toHaveProperty("output_config");
});

it("checks Google AI Studio access from one model page", async () => {
  const fake = providerAnswering({
    models: [{ name: "models/gemini" }],
    nextPageToken: "next",
  });
  expect(
    await fake.registry.google_ai_studio.checkAccess("synthetic-key", SIGNAL),
  ).toMatchObject({ ok: true, detail: { modelCount: 1, hasMoreModels: true } });
  expect(sentRequest(fake).url).toBe(
    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
  );
  expect(sentRequest(fake).url).not.toContain("synthetic-key");
});

it.each([
  [{}, false],
  [{ models: [{ id: "unnamed" }] }, false],
  [{ models: [], nextPageToken: "" }, true],
] as const)(
  "reads Google model page %j as accepted=%s",
  async (payload, isAccepted) => {
    const fake = providerAnswering(payload);
    expect(
      (await fake.registry.google_ai_studio.checkAccess("k", SIGNAL)).ok,
    ).toBe(isAccepted);
  },
);

it("tests a Gemini model with an encoded path and a thinking level", async () => {
  const fake = providerAnswering({
    candidates: [{ content: { parts: [{ text: "ok" }] } }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 },
  });
  expect(
    await fake.registry.google_ai_studio.runModelTest(
      modelTest({ model: "models/gemini/x", reasoningEffort: "medium" }),
      SIGNAL,
    ),
  ).toMatchObject({ ok: true, detail: { inputTokens: 3, outputTokens: 1 } });
  expect(sentRequest(fake).url).toBe(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini%2Fx:generateContent",
  );
  expect(sentRequest(fake).body).toMatchObject({
    generationConfig: {
      maxOutputTokens: 16,
      thinkingConfig: { thinkingLevel: "MEDIUM" },
    },
  });
  expect(geminiThinkingLevel("high")).toBe("HIGH");
});

it.each([
  [{ candidates: [] }, false],
  [{ candidates: [{ content: {} }] }, false],
  [{ candidates: [{ content: {}, finishReason: "MAX_TOKENS" }] }, true],
] as const)(
  "reads Gemini generation %j as accepted=%s",
  async (payload, isAccepted) => {
    const fake = providerAnswering(payload);
    expect(
      (await fake.registry.google_ai_studio.runModelTest(modelTest(), SIGNAL))
        .ok,
    ).toBe(isAccepted);
    expect(sentRequest(fake).body).not.toHaveProperty(
      "generationConfig.thinkingConfig",
    );
  },
);
