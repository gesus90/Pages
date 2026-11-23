import { describe, expect, it, vi } from "vitest";

import { OpenRouterProvider } from "@/backend/agents/providers/OpenRouterProvider";
import { ProviderHttpClient } from "@/backend/agents/providers/ProviderHttpClient";

import type {
  ProviderHttpOptions,
  ProviderHttpTransport,
} from "@/backend/agents/providers/ProviderContracts";

function setup(payload: unknown): {
  provider: OpenRouterProvider;
  calls: () => [string, ProviderHttpOptions][];
} {
  const transport = vi.fn<ProviderHttpTransport>(() =>
    Promise.resolve({ status: 200, json: () => Promise.resolve(payload) }),
  );
  return {
    provider: new OpenRouterProvider(new ProviderHttpClient(transport)),
    calls: () => transport.mock.calls,
  };
}

const signal = new AbortController().signal;

describe("OpenRouterProvider.checkAccess", () => {
  it("reports the allowance and the free tier", async () => {
    const { provider } = setup({
      data: { is_free_tier: false, limit_remaining: 5 },
    });
    expect(await provider.checkAccess("key", signal)).toMatchObject({
      ok: true,
      detail: { limitRemaining: 5, isFreeTier: false },
    });
  });

  it("refuses a response without the free-tier flag", async () => {
    expect((await setup({}).provider.checkAccess("k", signal)).ok).toBe(false);
  });
});

describe("OpenRouterProvider.readUsage", () => {
  const read = async (fields: unknown): Promise<unknown> =>
    setup({ data: fields }).provider.readUsage("key", signal);

  it("reads a limited key with its reset rhythm", async () => {
    expect(
      await read({
        usage: 2,
        limit: 10,
        limit_remaining: 8,
        limit_reset: "daily",
      }),
    ).toEqual({
      ok: true,
      value: { usage: 2, limit: 10, remaining: 8, reset: "daily" },
    });
  });

  it.each(["weekly", "monthly"])("accepts the %s reset", async (reset) => {
    expect(
      await read({ usage: 1, limit: null, limit_reset: reset }),
    ).toMatchObject({
      ok: true,
      value: { limit: null, remaining: null, reset },
    });
  });

  it("ignores unknown resets and negative amounts", async () => {
    expect(
      await read({ usage: 1, limit: 3, limit_remaining: -1, limit_reset: "x" }),
    ).toEqual({
      ok: true,
      value: { usage: 1, limit: 3, remaining: null, reset: null },
    });
  });

  it("keeps a limit when the usage is unreadable", async () => {
    expect(await read({ usage: "n", limit: 3 })).toMatchObject({
      ok: true,
      value: { usage: null, limit: 3 },
    });
  });

  it("refuses data without usage or a valid limit", async () => {
    expect(await read({ usage: "n", limit: -2 })).toMatchObject({ ok: false });
  });
});

describe("OpenRouterProvider.readCredits", () => {
  it("reads purchased and used credits", async () => {
    const { provider, calls } = setup({
      data: { total_credits: 10, total_usage: 4 },
    });
    expect(await provider.readCredits("mgmt", signal)).toEqual({
      ok: true,
      value: { purchased: 10, used: 4 },
    });
    expect(calls()[0]?.[0]).toMatch(/\/credits$/);
  });

  it("refuses malformed totals", async () => {
    expect(
      await setup({ data: { total_credits: "x" } }).provider.readCredits(
        "m",
        signal,
      ),
    ).toMatchObject({ ok: false });
  });
});

describe("OpenRouterProvider.runModelTest", () => {
  const completion = {
    choices: [{ message: { role: "assistant", content: "ok" } }],
  };
  const plain = { apiKey: "key", model: "m", reasoningEffort: null };

  it("sends a capped request without reasoning by default", async () => {
    const { provider, calls } = setup(completion);
    expect((await provider.runModelTest(plain, signal)).ok).toBe(true);
    expect(calls()[0]?.[1].body).toContain('"max_tokens":16');
    expect(calls()[0]?.[1].body).not.toContain("reasoning");
  });

  it("passes a reasoning effort", async () => {
    const { provider, calls } = setup(completion);
    await provider.runModelTest({ ...plain, reasoningEffort: "low" }, signal);
    expect(calls()[0]?.[1].body).toContain('"reasoning":{"effort":"low"}');
  });
});
