import { expect, it, vi } from "vitest";

import {
  findClaudePrice,
  OpenRouterPrices,
  parseOpenRouterPrices,
} from "@/backend/service/agents/sessions/OpenRouterPrices";
import { readClaudePriceModels } from "@/backend/service/agents/AgentConnectionValidation";

it("reads per-token string rates, applies prompt fallbacks and rejects malformed or negative prices", () => {
  const prices = parseOpenRouterPrices(
    {
      data: [
        {
          id: "anthropic/claude-haiku-5.5",
          pricing: { prompt: "0.000001", completion: "0.000005" },
        },
        { id: "anthropic/invalid", pricing: { prompt: "-1", completion: "1" } },
        { id: "openai/model", pricing: { prompt: "1", completion: "1" } },
      ],
    },
    "2026-11-13",
  );
  expect(prices).toEqual([
    {
      modelId: "anthropic/claude-haiku-5.5",
      fetchedAt: "2026-11-13",
      prompt: "0.000001",
      completion: "0.000005",
      cacheRead: "0.000001",
      cacheWrite: "0.000001",
    },
  ]);
  expect(findClaudePrice(prices, "claude-haiku-5-5")).toEqual(prices[0]);
  expect(findClaudePrice(prices, "claude-haiku-5-5-20261113[1m]")).toEqual(
    prices[0],
  );
  expect(findClaudePrice(prices, "claude-unlisted")).toBeNull();
  expect(
    findClaudePrice(
      [...prices, { ...prices[0], modelId: "anthropic/claude-haiku-5-5" }],
      "claude-haiku-5-5",
    ),
  ).toBeNull();
  expect(
    findClaudePrice(prices, "haiku", "anthropic/claude-haiku-5.5"),
  ).toEqual(prices[0]);
});

it("persists a validated public catalog and retains it unchanged when the network fails", async () => {
  let saved: { fetchedAt: string; catalog: string } | null = null;
  const repository = {
    read: vi.fn(async () => saved),
    save: vi.fn(async (fetchedAt: string, catalog: string) => {
      saved = { fetchedAt, catalog };
    }),
  };
  const request = vi.fn<typeof fetch>();
  request.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        data: [
          {
            id: "anthropic/claude-haiku-5.5",
            pricing: {
              prompt: "0.000001",
              completion: "0.000005",
              input_cache_read: "0.0000001",
            },
          },
        ],
      }),
    ),
  );
  request.mockRejectedValueOnce(new Error("offline"));
  const prices = new OpenRouterPrices(
    repository,
    request,
    () => new Date("2026-11-13T12:00:00Z"),
  );
  await prices.refresh();
  const cached = await repository.read();
  await prices.refresh();
  expect(await repository.read()).toEqual(cached);
  expect(repository.save).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith("https://openrouter.ai/api/v1/models", {
    signal: expect.any(AbortSignal),
  });
  expect(JSON.stringify(request.mock.calls)).not.toContain("Authorization");
});

it("validates admin overrides and preserves omitted mappings", () => {
  expect(readClaudePriceModels(undefined, "claude_code")).toBeUndefined();
  expect(
    readClaudePriceModels(
      { "claude-haiku-5-5": "anthropic/claude-haiku-5.5" },
      "claude_code",
    ),
  ).toEqual({ "claude-haiku-5-5": "anthropic/claude-haiku-5.5" });
  expect(() =>
    readClaudePriceModels({ haiku: "https://another-host" }, "claude_code"),
  ).toThrow();
  expect(() =>
    readClaudePriceModels({ haiku: "anthropic/model" }, "codex_cli"),
  ).toThrow();
});

it("refreshes once on startup and again after a day", async () => {
  vi.useFakeTimers();
  const request = vi.fn<typeof fetch>().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "anthropic/claude-haiku-5.5",
              pricing: { prompt: "0.000001", completion: "0.000005" },
            },
          ],
        }),
      ),
  );
  const repository = {
    read: vi.fn(async () => null),
    save: vi.fn(async () => undefined),
  };
  try {
    await new OpenRouterPrices(repository, request).start();
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(request).toHaveBeenCalledTimes(2);
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
});
