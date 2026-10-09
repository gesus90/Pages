import { describe, expect, it } from "vitest";

import { defaultCatalogModel } from "@/backend/agents/catalog/CatalogDefaults";

import { createCatalogModel } from "../helpers/agents";

const FIRST = createCatalogModel({ id: "first" });
const FREE = createCatalogModel({ id: "vendor/free:free", isFree: true });
const PAID = createCatalogModel({ id: "vendor/paid" });

describe("default model of a fresh catalog", () => {
  it("takes the first entry where the source orders its own default first", () => {
    for (const provider of ["codex_cli", "claude_code", "anthropic"] as const) {
      expect(defaultCatalogModel(provider, [FIRST, PAID])).toBe("first");
      expect(defaultCatalogModel(provider, [])).toBeNull();
    }
  });

  it("starts OpenRouter with its free router or a free model, never a paid one", () => {
    const router = createCatalogModel({ id: "openrouter/free", isFree: true });
    expect(defaultCatalogModel("openrouter", [PAID, FREE, router])).toBe(
      "openrouter/free",
    );
    expect(defaultCatalogModel("openrouter", [PAID, FREE])).toBe(
      "vendor/free:free",
    );
    expect(defaultCatalogModel("openrouter", [PAID])).toBeNull();
  });

  it("uses Google's latest Flash alias only when listed and marks no OpenAI or Z.AI default", () => {
    const flash = createCatalogModel({ id: "models/gemini-flash-latest" });
    expect(defaultCatalogModel("google_ai_studio", [FIRST, flash])).toBe(
      "models/gemini-flash-latest",
    );
    expect(defaultCatalogModel("google_ai_studio", [FIRST])).toBeNull();
    expect(defaultCatalogModel("openai", [FIRST])).toBeNull();
    expect(defaultCatalogModel("zai", [FIRST])).toBeNull();
  });
});
