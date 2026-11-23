import { expect, it, vi } from "vitest";

import { OpenAiProvider } from "@/backend/agents/providers/OpenAiProvider";
import { ProviderHttpClient } from "@/backend/agents/providers/ProviderHttpClient";

import type {
  ProviderHttpOptions,
  ProviderHttpTransport,
} from "@/backend/agents/providers/ProviderContracts";

function setup(payload: unknown): {
  provider: OpenAiProvider;
  calls: () => [string, ProviderHttpOptions][];
} {
  const transport = vi.fn<ProviderHttpTransport>(() =>
    Promise.resolve({ status: 200, json: () => Promise.resolve(payload) }),
  );
  return {
    provider: new OpenAiProvider(new ProviderHttpClient(transport)),
    calls: () => transport.mock.calls,
  };
}

const signal = new AbortController().signal;

it("checks access through the model listing", async () => {
  const { provider, calls } = setup({ data: [{ id: "a" }] });
  const outcome = await provider.checkAccess("key", signal);
  expect(outcome.ok).toBe(true);
  expect(calls()[0]?.[0]).toMatch(/\/models$/);
});

it("runs a capped chat completion for the model test", async () => {
  const { provider, calls } = setup({
    choices: [{ message: { role: "assistant", content: "ok" } }],
  });
  const outcome = await provider.runModelTest(
    { apiKey: "key", model: "gpt", reasoningEffort: null },
    signal,
  );
  expect(outcome.ok).toBe(true);
  expect(calls()[0]?.[0]).toMatch(/\/chat\/completions$/);
  expect(calls()[0]?.[1].body).toContain('"max_completion_tokens":16');
});
