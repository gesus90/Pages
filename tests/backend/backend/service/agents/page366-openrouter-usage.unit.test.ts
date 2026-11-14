import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { expect, it, vi } from "vitest";

import {
  parseOpenCodeNativeMessage,
  readOpenCodeNativeUsage,
} from "@/backend/service/agents/sessions/OpenCodeNativeUsage";
import {
  chargeOpenRouterMessage,
  OpenRouterPricing,
  parseOpenRouterCatalog,
} from "@/backend/service/agents/sessions/OpenRouterPricing";
import { sumTurnUsage } from "@/backend/service/agents/sessions/AgentSessionUsage";

const TOKENS = { input: 100, output: 20, reasoning: 5, cacheRead: 30, cacheWrite: 10 };
const MESSAGE = {
  role: "assistant",
  providerID: "openrouter",
  modelID: "example/code",
  time: { created: 1, completed: 2 },
  cost: 0.01,
  tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 30, write: 10 } },
};

it("counts completed native messages and child sessions while ignoring rejected requests", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pages-openrouter-"));
  const directory = path.join(root, "opencode");
  await mkdir(directory);
  const database = new DatabaseSync(path.join(directory, "opencode.db"));
  try {
    database.exec("CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT); CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, time_created INTEGER);");
    database.prepare("INSERT INTO session (id, parent_id) VALUES (?, ?)").run("root", null);
    database.prepare("INSERT INTO session (id, parent_id) VALUES (?, ?)").run("child", "root");
    const insert = database.prepare("INSERT INTO message (id, session_id, data, time_created) VALUES (?, ?, ?, ?)");
    insert.run("a", "root", JSON.stringify(MESSAGE), 1);
    insert.run("b", "child", JSON.stringify(MESSAGE), 2);
    insert.run("e", "root", JSON.stringify(MESSAGE), 2);
    insert.run("c", "root", JSON.stringify({ ...MESSAGE, error: { name: "APIError", statusCode: 429 } }), 3);
    insert.run("d", "root", JSON.stringify({ ...MESSAGE, time: { created: 4 } }), 4);
    expect(readOpenCodeNativeUsage(root, "root").map((message) => message.messageId)).toEqual(["a", "b", "e"]);
    expect(readOpenCodeNativeUsage(root, "root").map((message) => message.messageId)).toEqual(["a", "b", "e"]);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("prices each OpenRouter token kind using the public catalog and freezes a free result", () => {
  const prices = parseOpenRouterCatalog({ data: [
    { id: "example/code", pricing: { prompt: "0.00000015", completion: "0.0000006", input_cache_read: "0.00000005", internal_reasoning: "0.000001" } },
    { id: "example/free", pricing: { prompt: "0", completion: "0" } },
  ] });
  const snapshot = { fetchedAt: "2026-11-14T00:00:00.000Z", prices };
  const charge = chargeOpenRouterMessage("openrouter/example/code", TOKENS, snapshot);
  expect(charge.amount).toBeCloseTo(100 * 0.00000015 + 20 * 0.0000006 + 5 * 0.000001 + 30 * 0.00000005 + 10 * 0.00000015, 12);
  expect(charge.prices?.inputCacheWrite).toBe(0.00000015);
  expect(chargeOpenRouterMessage("openrouter/example/free", TOKENS, snapshot).state).toBe("free");
  expect(chargeOpenRouterMessage("openrouter/example/unknown", TOKENS, snapshot).state).toBe("unknown");
  expect(chargeOpenRouterMessage("openrouter/example/anything:free", TOKENS, null)).toMatchObject({ state: "free", amount: 0 });
});

it("sums priced messages once per attempt and turn, preserving reasoning and cache", () => {
  const usage = {
    attemptId: "attempt", turn: 1, provider: "opencode" as const,
    model: "openrouter/example/code", inputTokens: 100, outputTokens: 20,
    reasoningTokens: 5, cacheReadTokens: 30, cacheWriteTokens: 10,
    totalTokens: 165, inputIncludesCache: false, isPartial: false,
    costAmount: 0.000035, costState: "known" as const,
    reportedAt: "2026-11-14T00:00:00.000Z",
  };
  expect(sumTurnUsage([usage, usage])[0]).toMatchObject({
    inputTokens: 100, outputTokens: 20, reasoningTokens: 5,
    cacheReadTokens: 30, cacheWriteTokens: 10, costAmount: 0.000035,
  });
  expect(parseOpenCodeNativeMessage("s", "m", MESSAGE)?.tokens).toEqual(TOKENS);
});

it("uses a persisted catalog stand when the daily public fetch is unavailable", async () => {
  const saved = {
    fetchedAt: "2026-01-01T00:00:00.000Z",
    prices: { "example/code": {
      prompt: 0.00000015, completion: 0.0000006,
      inputCacheRead: 0.00000005, inputCacheWrite: 0.00000015,
      internalReasoning: 0.000001,
    } },
  };
  const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  try {
    const pricing = new OpenRouterPricing({
      load: async () => saved,
      save: async () => { throw new Error("unexpected save"); },
    });
    await pricing.start();
    expect(pricing.current()?.fetchedAt).toBe(saved.fetchedAt);
    expect(chargeOpenRouterMessage("openrouter/example/code", TOKENS, pricing.current()).state).toBe("known");
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    fetcher.mockRestore();
  }
});
