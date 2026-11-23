import { expect, it } from "vitest";

import { createApiProviderRegistry } from "@/backend/agents/providers/ApiProviderRegistry";
import { ProviderHttpClient } from "@/backend/agents/providers/ProviderHttpClient";

it("wires one adapter per API provider", () => {
  const registry = createApiProviderRegistry(
    new ProviderHttpClient(() => Promise.reject(new Error("unused"))),
  );
  expect(Object.keys(registry).sort()).toEqual([
    "anthropic",
    "google_ai_studio",
    "openai",
    "openrouter",
  ]);
  expect(registry.openai.provider).toBe("openai");
});

it("creates a default client when none is injected", () => {
  expect(createApiProviderRegistry().anthropic.provider).toBe("anthropic");
});
