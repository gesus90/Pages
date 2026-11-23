import { describe, expect, it, vi } from "vitest";

import {
  GoogleAiStudioProvider,
  geminiThinkingLevel,
} from "@/backend/agents/providers/GoogleAiStudioProvider";
import { ProviderHttpClient } from "@/backend/agents/providers/ProviderHttpClient";

import type {
  ProviderHttpOptions,
  ProviderHttpTransport,
} from "@/backend/agents/providers/ProviderContracts";

function setup(payload: unknown): {
  provider: GoogleAiStudioProvider;
  calls: () => [string, ProviderHttpOptions][];
} {
  const transport = vi.fn<ProviderHttpTransport>(() =>
    Promise.resolve({ status: 200, json: () => Promise.resolve(payload) }),
  );
  return {
    provider: new GoogleAiStudioProvider(new ProviderHttpClient(transport)),
    calls: () => transport.mock.calls,
  };
}

const signal = new AbortController().signal;
const plain = { apiKey: "key", model: "models/gem ini", reasoningEffort: null };
const generation = {
  candidates: [{ content: { parts: [] } }],
  usageMetadata: { promptTokenCount: 4 },
};

describe("GoogleAiStudioProvider.checkAccess", () => {
  it("counts models and the pagination hint", async () => {
    const { provider } = setup({ models: [{ name: "a" }], nextPageToken: "t" });
    expect(await provider.checkAccess("key", signal)).toMatchObject({
      ok: true,
      detail: { modelCount: 1, hasMoreModels: true },
    });
  });

  it("treats an empty page token as no further page", async () => {
    const { provider } = setup({ models: [], nextPageToken: "" });
    expect(await provider.checkAccess("key", signal)).toMatchObject({
      detail: { hasMoreModels: false },
    });
  });

  it("refuses missing arrays and unnamed models", async () => {
    expect((await setup({}).provider.checkAccess("k", signal)).ok).toBe(false);
    expect(
      (await setup({ models: [{}] }).provider.checkAccess("k", signal)).ok,
    ).toBe(false);
  });
});

describe("GoogleAiStudioProvider.runModelTest", () => {
  it("encodes the model and omits thinking without an effort", async () => {
    const { provider, calls } = setup(generation);
    const outcome = await provider.runModelTest(plain, signal);
    expect(outcome).toMatchObject({ ok: true, detail: { inputTokens: 4 } });
    expect(calls()[0]?.[0]).toMatch(/\/models\/gem%20ini:generateContent$/);
    expect(calls()[0]?.[1].body).not.toContain("thinkingConfig");
  });

  it("sends the thinking level for an effort", async () => {
    const { provider, calls } = setup(generation);
    await provider.runModelTest(
      { ...plain, reasoningEffort: "medium" },
      signal,
    );
    expect(calls()[0]?.[1].body).toContain('"thinkingLevel":"MEDIUM"');
  });

  it("accepts a candidate truncated at the token cap", async () => {
    const { provider } = setup({
      candidates: [{ finishReason: "MAX_TOKENS" }],
    });
    expect((await provider.runModelTest(plain, signal)).ok).toBe(true);
  });

  it("refuses missing candidates and candidates without parts", async () => {
    for (const payload of [{}, { candidates: [] }, { candidates: [{}] }]) {
      expect(
        (await setup(payload).provider.runModelTest(plain, signal)).ok,
      ).toBe(false);
    }
  });
});

it("names thinking levels in upper case", () => {
  expect(geminiThinkingLevel("low")).toBe("LOW");
});
