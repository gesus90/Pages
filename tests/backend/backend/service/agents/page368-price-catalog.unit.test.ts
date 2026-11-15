import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AntigravityPriceCatalog } from "@/backend/service/agents/sessions/AntigravityPriceCatalog";

import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";

const boundary = vi.hoisted(() => ({
  readFile: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
}));
vi.mock("node:fs/promises", () => boundary);
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const AT = "2026-11-15T12:00:00.000Z";

function usage(
  overrides: Partial<AgentSessionTurnUsage> = {},
): AgentSessionTurnUsage {
  return {
    attemptId: "a",
    turn: 1,
    provider: "antigravity",
    model: "gemini-test",
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 120,
    inputIncludesCache: null,
    isPartial: true,
    reportedAt: AT,
    ...overrides,
  };
}

function catalog(
  pricing: Record<string, unknown> = {},
): AntigravityPriceCatalog {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "google/gemini-test",
            pricing: {
              prompt: "0.000001",
              completion: "0.000002",
              ...pricing,
            },
          },
        ],
      }),
    }),
  );
  return new AntigravityPriceCatalog("/synthetic/openrouter-prices.json");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AT);
  boundary.readFile.mockReset().mockRejectedValue({ code: "ENOENT" });
  boundary.mkdir.mockReset().mockResolvedValue(undefined);
  boundary.writeFile.mockReset().mockResolvedValue(undefined);
  boundary.rename.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("prices exact Google selectors and caches a dated public catalogue once per day", async () => {
  const prices = catalog();
  const [first, second] = await Promise.all([
    prices.calculate(usage()),
    prices.calculate(usage({ turn: 2 })),
  ]);
  expect(first.amountUsd).toBeCloseTo(0.00014);
  expect(second).toEqual(first);
  expect(first).toMatchObject({
    modelId: "google/gemini-test",
    priceAsOf: AT,
    gap: null,
  });
  expect(fetch).toHaveBeenCalledOnce();
  expect(boundary.writeFile).toHaveBeenCalledWith(
    "/synthetic/openrouter-prices.json.pending",
    expect.any(String),
    { mode: 0o600 },
  );
});

it("does not guess Hydrogen aliases, missing counts, cache semantics or cache prices", async () => {
  const prices = catalog();
  expect(
    (await prices.calculate(usage({ model: "gemini-4-hydrogen" }))).gap,
  ).toBe("model");
  expect((await prices.calculate(usage({ cacheReadTokens: null }))).gap).toBe(
    "tokens",
  );
  expect((await prices.calculate(usage({ cacheReadTokens: 50 }))).gap).toBe(
    "cache_semantics",
  );
  expect(
    (
      await prices.calculate(
        usage({ cacheReadTokens: 50, inputIncludesCache: true }),
      )
    ).gap,
  ).toBe("price");
  expect(
    (await prices.calculate(usage({ inputTokens: -1 }))).amountUsd,
  ).toBeNull();
  expect((await prices.calculate(usage({ model: null }))).amountUsd).toBeNull();
});

it("subtracts included cache reads once and never adds reasoning to output", async () => {
  const prices = catalog({
    input_cache_read: "0.0000001",
    internal_reasoning: "1",
  });
  const result = await prices.calculate(
    usage({ cacheReadTokens: 50, inputIncludesCache: true }),
  );
  expect(result.amountUsd).toBeCloseTo(0.000095);
  expect(
    (
      await prices.calculate(
        usage({ cacheReadTokens: 150, inputIncludesCache: true }),
      )
    ).gap,
  ).toBe("cache_semantics");
});

it("accepts explicitly free rates and rejects blank or absent required prices", async () => {
  expect(
    (await catalog({ prompt: "0", completion: "0" }).calculate(usage()))
      .amountUsd,
  ).toBe(0);
  expect(
    (await catalog({ prompt: "" }).calculate(usage())).amountUsd,
  ).toBeNull();
  expect(
    (
      await catalog({ input_cache_write: "" }).calculate(
        usage({ cacheWriteTokens: 4, inputIncludesCache: false }),
      )
    ).gap,
  ).toBe("price");
});

it("keeps an offline price snapshot and throttles failed refreshes", async () => {
  boundary.readFile.mockResolvedValue(
    JSON.stringify({
      fetchedAt: "2026-11-01T00:00:00.000Z",
      models: [
        {
          id: "google/gemini-test",
          prompt: 0.000001,
          completion: 0.000002,
          inputCacheRead: null,
          inputCacheWrite: null,
        },
      ],
    }),
  );
  const prices = catalog();
  vi.mocked(fetch).mockRejectedValue(new Error("offline"));
  expect((await prices.calculate(usage())).amountUsd).toBeCloseTo(0.00014);
  expect((await prices.calculate(usage())).priceAsOf).toBe(
    "2026-11-01T00:00:00.000Z",
  );
  expect(fetch).toHaveBeenCalledOnce();
});
