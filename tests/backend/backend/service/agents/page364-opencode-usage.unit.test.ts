import { beforeEach, expect, it, vi } from "vitest";

import { readOpenCodeMessage } from "@/backend/agents/cli/OpenCodeSessionUsage";
import { readOpenCodePriceMapping } from "@/backend/service/agents/AgentConnectionValidation";
import { sumOpenCodeUsage } from "@/backend/service/agents/sessions/OpenCodeUsage";
import { OpenRouterPriceCatalog } from "@/backend/service/agents/sessions/OpenRouterPriceCatalog";

import type { OpenCodeMessageUsage } from "@/backend/agents/cli/OpenCodeSessionUsage";
import type { StoredOpenCodeUsage } from "@/backend/service/agents/sessions/OpenCodeUsage";

const files = vi.hoisted(() => ({
  saved: "",
  lastPath: "",
  reads: 0,
  writes: 0,
}));

vi.mock("node:fs/promises", () => ({
  readFile: async (): Promise<string> => {
    files.reads += 1;
    if (!files.saved)
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return files.saved;
  },
  mkdir: async (): Promise<void> => undefined,
  writeFile: async (filePath: string, content: string): Promise<void> => {
    files.lastPath = filePath;
    files.saved = content;
    files.writes += 1;
  },
  rename: async (): Promise<void> => undefined,
}));

const message: OpenCodeMessageUsage = {
  id: "msg-one",
  sessionId: "ses-one",
  model: "openrouter/z-ai/glm-5.3",
  inputTokens: 100,
  outputTokens: 10,
  reasoningTokens: 5,
  cacheReadTokens: 20,
  cacheWriteTokens: 30,
  costUsd: 0.9,
};

const catalogue = {
  data: [
    {
      id: "z-ai/glm-5.3",
      pricing: {
        prompt: "0.000001",
        completion: "0.000002",
        input_cache_read: "0.0000002",
        input_cache_write: "0.0000003",
        internal_reasoning: "0.000004",
      },
    },
  ],
};

beforeEach(() => {
  files.saved = "";
  files.reads = 0;
  files.writes = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => catalogue })),
  );
});

it("reads every reported native token kind and keeps a missing report unknown", () => {
  const parsed = readOpenCodeMessage({
    id: "msg-one",
    session_id: "ses-one",
    data: JSON.stringify({
      role: "assistant",
      providerID: "opencode",
      modelID: "glm-5.3-flash-free",
      tokens: {
        input: 11,
        output: 12,
        reasoning: 13,
        cache: { read: 14, write: 15 },
      },
      cost: 0,
    }),
  });
  expect(parsed).toMatchObject({
    model: "opencode/glm-5.3-flash-free",
    inputTokens: 11,
    outputTokens: 12,
    reasoningTokens: 13,
    cacheReadTokens: 14,
    cacheWriteTokens: 15,
    costUsd: 0,
  });
  expect(
    readOpenCodeMessage({
      id: "msg-two",
      session_id: "ses-one",
      data: JSON.stringify({ role: "assistant" }),
    })?.inputTokens,
  ).toBeNull();
});

it("prices paid token kinds, reuses a saved catalogue, and honors an admin mapping", async () => {
  const first = new OpenRouterPriceCatalog("/isolated/prices.json");
  const paid = await first.calculate(message);
  expect(paid.state).toBe("catalog");
  expect(paid.amount).toBeCloseTo(0.000153, 12);
  expect(paid.priceAsOf).not.toBeNull();
  expect(files.writes).toBe(1);
  const reused = new OpenRouterPriceCatalog("/isolated/prices.json");
  expect(await reused.calculate({ ...message, model: "zai/glm-5.3" })).toEqual(
    paid,
  );
  expect(
    await reused.calculate(
      { ...message, model: "other/model" },
      {
        "other/model": "z-ai/glm-5.3",
      },
    ),
  ).toEqual(paid);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("keeps free tokens, native fallback and unknown prices distinct", async () => {
  const prices = new OpenRouterPriceCatalog("/isolated/prices.json");
  expect(
    await prices.calculate({ ...message, model: "opencode/flash-free" }),
  ).toEqual({
    amount: 0,
    state: "free",
    priceAsOf: null,
  });
  expect(
    await prices.calculate(
      { ...message, model: "opencode/zero-cost" },
      undefined,
      true,
    ),
  ).toMatchObject({ amount: 0, state: "free" });
  expect(await prices.calculate({ ...message, model: "other/model" })).toEqual({
    amount: 0.9,
    state: "native",
    priceAsOf: null,
  });
  expect(
    await prices.calculate({ ...message, model: "other/model", costUsd: null }),
  ).toEqual({
    amount: null,
    state: "unknown",
    priceAsOf: null,
  });
});

it("adds two iterations once and marks unreported usage incomplete", () => {
  const first: StoredOpenCodeUsage = {
    ...message,
    attemptId: "iteration-one",
    turn: 1,
    price: { amount: 0, state: "free", priceAsOf: null },
    reportedAt: "2026-11-14T10:00:00Z",
  };
  const second = { ...first, id: "msg-two", attemptId: "iteration-two" };
  expect(sumOpenCodeUsage([first, second])).toMatchObject({
    messages: 2,
    inputTokens: 200,
    reasoningTokens: 10,
    costUsd: 0,
    costState: "free",
    isIncomplete: false,
  });
  expect(sumOpenCodeUsage([])).toMatchObject({
    inputTokens: null,
    costUsd: null,
    isIncomplete: true,
  });
  expect(
    sumOpenCodeUsage([first], new Set(["iteration-one", "iteration-two"])),
  ).toMatchObject({ inputTokens: 100, isIncomplete: true });
});

it("accepts only bounded administrator OpenRouter mappings", () => {
  expect(
    readOpenCodePriceMapping({ "zai/glm-5.3": "z-ai/glm-5.3" }, "opencode"),
  ).toEqual({ "zai/glm-5.3": "z-ai/glm-5.3" });
  expect(() =>
    readOpenCodePriceMapping({ "zai/glm-5.3": "wrong" }, "opencode"),
  ).toThrow();
});
