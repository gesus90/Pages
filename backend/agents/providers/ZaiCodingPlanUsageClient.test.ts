import { beforeEach, expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import {
  ZaiCodingPlanUsageClient,
  readZaiCodingPlanUsage,
} from "@/backend/agents/providers/ZaiCodingPlanUsageClient";

import type { ProviderHttpResponse } from "@/backend/agents/providers/ProviderContracts";

const logEvent = vi.hoisted(() => vi.fn());

vi.mock("@/backend/logging/Logger", () => ({ logEvent }));

const FUTURE_MS = 4_102_444_800_000;
const FUTURE_ISO = "2100-01-01T00:00:00.000Z";
const PAST_MS = 1_700_000_000_000;

beforeEach(() => {
  logEvent.mockReset();
});

function envelope(limits: unknown, extra: object = {}): unknown {
  return { code: 200, success: true, data: { limits, ...extra } };
}

function failureCode(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error: unknown) {
    return error instanceof AgentError ? error.code : "other";
  }
  return undefined;
}

it("classifies envelope failures", () => {
  expect(failureCode(() => readZaiCodingPlanUsage({ code: 1001 }))).toBe(
    "provider_auth_failed",
  );
  expect(failureCode(() => readZaiCodingPlanUsage({ success: false }))).toBe(
    "provider_bad_response",
  );
  expect(failureCode(() => readZaiCodingPlanUsage({ code: 500 }))).toBe(
    "provider_bad_response",
  );
  expect(
    failureCode(() => readZaiCodingPlanUsage({ code: 200, data: {} })),
  ).toBe("provider_bad_response");
  expect(failureCode(() => readZaiCodingPlanUsage("text"))).toBe(
    "provider_bad_response",
  );
});

it("reads percentages, counts, lengths and resets of known types", () => {
  const usage = readZaiCodingPlanUsage(
    envelope(
      [
        {
          type: "TOKENS_LIMIT",
          unit: 3,
          number: 5,
          percentage: "150",
          currentValue: 10,
          usage: 100,
          remaining: 90,
          nextResetTime: FUTURE_MS,
        },
        {
          type: "TOKENS_LIMIT",
          unit: 6,
          number: 1,
          percentage: -5,
          nextResetTime: FUTURE_ISO,
        },
        {
          type: "TIME_LIMIT",
          unit: 5,
          number: 1,
          currentValue: 25,
          usage: 100,
        },
      ],
      { level: " pro " },
    ),
  );
  expect(usage.plan).toBe("pro");
  expect(usage.unreadableCount).toBe(0);
  expect(usage.windows).toEqual([
    {
      key: "tokens-5hours",
      measure: "tokens",
      length: { unit: "hours", count: 5 },
      usedPercent: 100,
      used: 10,
      limit: 100,
      remaining: 90,
      resetsAt: FUTURE_ISO,
    },
    {
      key: "tokens-1weeks",
      measure: "tokens",
      length: { unit: "weeks", count: 1 },
      usedPercent: 0,
      used: null,
      limit: null,
      remaining: null,
      resetsAt: FUTURE_ISO,
    },
    {
      key: "mcp-1months",
      measure: "mcp",
      length: { unit: "months", count: 1 },
      usedPercent: 25,
      used: 25,
      limit: 100,
      remaining: null,
      resetsAt: null,
    },
  ]);
});

it("derives the used share from remaining counts and rejects bad limits", () => {
  const usage = readZaiCodingPlanUsage(
    envelope([
      { type: "TOKENS_LIMIT", usage: 200, remaining: 50 },
      { type: "TOKENS_LIMIT", usage: 0, currentValue: 1 },
      { type: "TOKENS_LIMIT", usage: 100 },
      { type: "TOKENS_LIMIT", usage: -4, currentValue: 1 },
    ]),
  );
  expect(usage.windows.map((window) => window.usedPercent)).toEqual([
    75,
    null,
    null,
    null,
  ]);
});

it("ignores percentages that are no finite numbers", () => {
  const usage = readZaiCodingPlanUsage(
    envelope([
      { type: "TOKENS_LIMIT", percentage: Infinity },
      { type: "TOKENS_LIMIT", percentage: "abc" },
      { type: "TOKENS_LIMIT", percentage: true },
    ]),
  );
  expect(usage.windows.map((window) => window.usedPercent)).toEqual([
    null,
    null,
    null,
  ]);
});

it("treats unreadable lengths as unknown", () => {
  const usage = readZaiCodingPlanUsage(
    envelope([
      { type: "TOKENS_LIMIT", percentage: 1, unit: 3 },
      { type: "TOKENS_LIMIT", percentage: 1, unit: 3, number: 1.5 },
      { type: "TOKENS_LIMIT", percentage: 1, unit: 3, number: 0 },
      { type: "TOKENS_LIMIT", percentage: 1, unit: 9, number: 1 },
    ]),
  );
  expect(usage.windows.every((window) => window.length === null)).toBe(true);
  expect(usage.windows.map((window) => window.key)).toEqual([
    "tokens-unknown",
    "tokens-unknown-2",
    "tokens-unknown-3",
    "tokens-unknown-4",
  ]);
});

it("treats unreadable resets as unknown", () => {
  const usage = readZaiCodingPlanUsage(
    envelope([
      { type: "TOKENS_LIMIT", percentage: 1, nextResetTime: 5 },
      {
        type: "TOKENS_LIMIT",
        percentage: 1,
        nextResetTime: "2026-99-99T99:99",
      },
      { type: "TOKENS_LIMIT", percentage: 1, nextResetTime: 1e20 },
      { type: "TOKENS_LIMIT", percentage: 1, nextResetTime: null },
    ]),
  );
  expect(usage.windows.every((window) => window.resetsAt === null)).toBe(true);
});

it("omits unreadable entries and counts them", () => {
  const usage = readZaiCodingPlanUsage(
    envelope([
      "text",
      null,
      [],
      { type: "OTHER" },
      { type: 5, percentage: 10 },
      { type: "TIME_LIMIT" },
      { type: "TIME_LIMIT", nextResetTime: FUTURE_MS },
    ]),
  );
  expect(usage.plan).toBeNull();
  expect(usage.unreadableCount).toBe(4);
  expect(usage.windows.map((window) => window.key)).toEqual([
    "quota-unknown",
    "mcp-unknown",
  ]);
});

it("reads only plain, short plan names", () => {
  expect(readZaiCodingPlanUsage(envelope([], { level: 3 })).plan).toBeNull();
  expect(readZaiCodingPlanUsage(envelope([], { level: "  " })).plan).toBeNull();
  expect(
    readZaiCodingPlanUsage(envelope([], { level: "x".repeat(41) })).plan,
  ).toBeNull();
});

function response(
  status: number,
  json: () => Promise<unknown>,
): ProviderHttpResponse {
  return { status, json };
}

const goodBody = envelope([
  { type: "TOKENS_LIMIT", percentage: 10, unit: 3, number: 5 },
]);

it("requests the quota without redirects and logs at debug level", async () => {
  const request = vi.fn(() =>
    Promise.resolve(response(200, async () => goodBody)),
  );
  const usage = await new ZaiCodingPlanUsageClient(request).read(
    "key",
    new AbortController().signal,
  );
  expect(usage.windows).toHaveLength(1);
  expect(request).toHaveBeenCalledWith(
    "https://api.z.ai/api/monitor/usage/quota/limit",
    expect.objectContaining({
      method: "GET",
      redirect: "error",
      headers: expect.objectContaining({ Authorization: "key" }) as unknown,
    }),
  );
  expect(logEvent.mock.calls.map(([event]) => event.level)).toEqual([
    "debug",
    "debug",
  ]);
});

it("logs answers without windows or with unreadable entries as information", async () => {
  const empty = vi.fn(() =>
    Promise.resolve(response(200, async () => envelope([]))),
  );
  await new ZaiCodingPlanUsageClient(empty).read(
    "key",
    new AbortController().signal,
  );
  expect(logEvent.mock.calls[1]?.[0].level).toBe("info");
  logEvent.mockReset();
  const mixed = vi.fn(() =>
    Promise.resolve(
      response(200, async () =>
        envelope([
          { type: "TOKENS_LIMIT", percentage: 1, nextResetTime: PAST_MS },
          { type: "TOKENS_LIMIT", percentage: 1, nextResetTime: FUTURE_MS },
          { type: "ODD type", percentage: 1, usage: 5, remaining: 1 },
          { type: "X", unit: 3, number: 2 },
          { type: "TIME_LIMIT" },
        ]),
      ),
    ),
  );
  await new ZaiCodingPlanUsageClient(mixed).read(
    "key",
    new AbortController().signal,
  );
  const quotaLog = logEvent.mock.calls[1]?.[0] as
    | { level: string; metadata: { diagnostic: string; hiddenEntries: number } }
    | undefined;
  expect(quotaLog?.level).toBe("info");
  expect(quotaLog?.metadata.diagnostic).toBe(
    [
      "TOKENS_LIMIT/window/u?n?/pct/reset-",
      "TOKENS_LIMIT/window/u?n?/pct/reset+",
      "other/window/u?n?/pct,lim,rem/reset?",
      "X/unknown_type/u3n2/nofigures/reset?",
      "TIME_LIMIT/mcp_without_window/u?n?/nofigures/reset?",
    ].join(";"),
  );
  expect(quotaLog?.metadata.hiddenEntries).toBe(1);
});

it("keeps at most six windows with token windows before MCP", () => {
  const usage = readZaiCodingPlanUsage(
    envelope([
      { type: "TIME_LIMIT", unit: 5, number: 1 },
      ...Array.from({ length: 6 }, () => ({
        type: "TOKENS_LIMIT",
        percentage: 1,
      })),
    ]),
  );
  expect(usage.windows.map((window) => window.measure)).toEqual(
    Array<string>(6).fill("tokens"),
  );
});

it.each([
  [401, "provider_auth_failed"],
  [403, "provider_auth_failed"],
  [429, "provider_rate_limited"],
  [503, "provider_unavailable"],
  [404, "provider_request_rejected"],
  [199, "provider_request_rejected"],
  [300, "provider_request_rejected"],
])("maps HTTP %i to %s and logs a warning", async (status, code) => {
  const request = vi.fn(() =>
    Promise.resolve(response(status, async () => goodBody)),
  );
  await expect(
    new ZaiCodingPlanUsageClient(request).read(
      "key",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code });
  expect(logEvent.mock.calls[0]?.[0].level).toBe(
    status < 400 ? "debug" : "warn",
  );
});

it("fails on an unreadable body", async () => {
  const broken = vi.fn(() =>
    Promise.resolve(response(200, () => Promise.reject(new Error("x")))),
  );
  await expect(
    new ZaiCodingPlanUsageClient(broken).read(
      "key",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "provider_bad_response" });
  const controller = new AbortController();
  const aborting = vi.fn(() =>
    Promise.resolve(
      response(200, () => {
        controller.abort();
        return Promise.reject(new Error("x"));
      }),
    ),
  );
  await expect(
    new ZaiCodingPlanUsageClient(aborting).read("key", controller.signal),
  ).rejects.toMatchObject({ code: "check_timeout" });
});

it("fails with a timeout when the deadline passes while reading", async () => {
  const controller = new AbortController();
  const request = vi.fn(() =>
    Promise.resolve(
      response(200, async () => {
        controller.abort();
        return goodBody;
      }),
    ),
  );
  await expect(
    new ZaiCodingPlanUsageClient(request).read("key", controller.signal),
  ).rejects.toMatchObject({ code: "check_timeout" });
});

it("classifies transport failures", async () => {
  const aborted = new AbortController();
  aborted.abort();
  const never = vi.fn();
  await expect(
    new ZaiCodingPlanUsageClient(never).read("key", aborted.signal),
  ).rejects.toMatchObject({ code: "check_timeout" });
  expect(never).not.toHaveBeenCalled();
  const down = vi.fn(() => Promise.reject(new Error("down")));
  await expect(
    new ZaiCodingPlanUsageClient(down).read(
      "key",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "provider_unreachable" });
  const known = vi.fn(() =>
    Promise.reject(new AgentError("provider_auth_failed")),
  );
  await expect(
    new ZaiCodingPlanUsageClient(known).read(
      "key",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "provider_auth_failed" });
});

it("uses fetch by default", async () => {
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("offline"));
  await expect(
    new ZaiCodingPlanUsageClient().read("key", new AbortController().signal),
  ).rejects.toMatchObject({ code: "provider_unreachable" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockRestore();
});
