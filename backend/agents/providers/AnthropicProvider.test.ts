import { describe, expect, it, vi } from "vitest";

import { AnthropicProvider } from "@/backend/agents/providers/AnthropicProvider";
import { ProviderHttpClient } from "@/backend/agents/providers/ProviderHttpClient";

import type {
  ProviderHttpOptions,
  ProviderHttpTransport,
} from "@/backend/agents/providers/ProviderContracts";

function setup(payload: unknown): {
  provider: AnthropicProvider;
  calls: () => [string, ProviderHttpOptions][];
} {
  const transport = vi.fn<ProviderHttpTransport>(() =>
    Promise.resolve({ status: 200, json: () => Promise.resolve(payload) }),
  );
  return {
    provider: new AnthropicProvider(new ProviderHttpClient(transport)),
    calls: () => transport.mock.calls,
  };
}

const signal = new AbortController().signal;
const message = { type: "message", content: [], usage: { input_tokens: 3 } };

describe("AnthropicProvider", () => {
  it("checks access through the model listing", async () => {
    const { provider, calls } = setup({ data: [{ id: "a" }] });
    expect((await provider.checkAccess("key", signal)).ok).toBe(true);
    expect(calls()[0]?.[0]).toMatch(/\/models$/);
  });

  it("sends the test message without an effort by default", async () => {
    const { provider, calls } = setup(message);
    const outcome = await provider.runModelTest(
      { apiKey: "key", model: "claude", reasoningEffort: null },
      signal,
    );
    expect(outcome).toMatchObject({ ok: true, detail: { inputTokens: 3 } });
    expect(calls()[0]?.[1].body).not.toContain("output_config");
  });

  it("passes a reasoning effort as output config", async () => {
    const { provider, calls } = setup(message);
    await provider.runModelTest(
      { apiKey: "key", model: "claude", reasoningEffort: "high" },
      signal,
    );
    expect(calls()[0]?.[1].body).toContain('"output_config":{"effort":"high"}');
  });

  it("refuses responses that are not messages", async () => {
    const { provider } = setup({ type: "error" });
    expect(
      await provider.runModelTest(
        { apiKey: "key", model: "claude", reasoningEffort: null },
        signal,
      ),
    ).toMatchObject({ ok: false, errorCode: "provider_bad_response" });
  });
});
