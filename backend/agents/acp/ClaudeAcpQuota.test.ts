import { beforeEach, expect, it, vi } from "vitest";

import {
  readClaudeAuthPlan,
  readClaudeQuotaWindow,
  registerClaudeQuota,
} from "@/backend/agents/acp/ClaudeAcpQuota";
import { logCaughtError } from "@/backend/logging/Logger";

import type { client as acpClient } from "@agentclientprotocol/sdk";
import type { AcpSessionContext } from "@/backend/agents/acp/AcpSessionContracts";
import type { ClaudeQuotaSink } from "@/backend/agents/acp/ClaudeAcpQuota";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const RESET_SECONDS = 1_900_000_000;
const RESET_ISO = new Date(RESET_SECONDS * 1_000).toISOString();

function event(limit: Record<string, unknown>): unknown {
  return { "_claude/rateLimit": limit };
}

it("reads nothing from an update without a rate limit event", () => {
  expect(readClaudeQuotaWindow(undefined)).toBeNull();
  expect(readClaudeQuotaWindow({})).toBeNull();
});

it("reads nothing for an unknown window or a missing reset", () => {
  expect(
    readClaudeQuotaWindow(
      event({
        rateLimitType: "other",
        resetsAt: RESET_SECONDS,
        utilization: 1,
      }),
    ),
  ).toBeNull();
  expect(
    readClaudeQuotaWindow(
      event({ rateLimitType: "five_hour", utilization: 1 }),
    ),
  ).toBeNull();
});

it("clamps the reported utilization to a percentage", () => {
  const read = (utilization: number): unknown =>
    readClaudeQuotaWindow(
      event({
        rateLimitType: "five_hour",
        resetsAt: RESET_SECONDS,
        utilization,
      }),
    );
  expect(read(0.1234)).toEqual({
    kind: "five_hour",
    usedPercentage: 12.34,
    resetsAt: RESET_ISO,
  });
  expect(read(5)).toMatchObject({ usedPercentage: 100 });
  expect(read(-1)).toMatchObject({ usedPercentage: 0 });
});

it("counts a rejected window without a figure as used up", () => {
  expect(
    readClaudeQuotaWindow(
      event({
        rateLimitType: "seven_day",
        resetsAt: RESET_SECONDS,
        status: "rejected",
      }),
    ),
  ).toMatchObject({ kind: "seven_day", usedPercentage: 100 });
});

it("reads nothing without a figure and without a rejection", () => {
  expect(
    readClaudeQuotaWindow(
      event({
        rateLimitType: "seven_day",
        resetsAt: RESET_SECONDS,
        utilization: Number.NaN,
        status: "allowed",
      }),
    ),
  ).toBeNull();
});

it("reads the plan of an account sign-in", () => {
  expect(
    readClaudeAuthPlan({
      authStatus: { kind: "account", account: { plan: "Max" } },
    }),
  ).toBe("max");
  expect(readClaudeAuthPlan({ authStatus: { kind: "account" } })).toBeNull();
});

it("reads no subscription from other sign-ins", () => {
  expect(readClaudeAuthPlan({ authStatus: { kind: "api_key" } })).toBeNull();
  expect(
    readClaudeAuthPlan({ authStatus: { kind: "signed_out" } }),
  ).toBeUndefined();
  expect(readClaudeAuthPlan("garbage")).toBeUndefined();
});

type Handler = (message: { params: unknown }) => void;

function registered(
  provider: string,
  sink: ClaudeQuotaSink | undefined,
): Handler | null {
  let handler: Handler | null = null;
  const client = {
    onNotification: (...parameters: [string, unknown, Handler]) => {
      handler = parameters[2];
    },
  } as unknown as ReturnType<typeof acpClient>;
  registerClaudeQuota(client, {
    driver: { provider },
    claudeQuota: sink,
  } as unknown as AcpSessionContext);
  return handler;
}

beforeEach(() => {
  vi.mocked(logCaughtError).mockReset();
});

it("listens only in a Claude session with a sink", () => {
  const sink = { recordWindow: vi.fn(), recordPlan: vi.fn() };
  expect(registered("codex_cli", sink)).toBeNull();
  expect(registered("claude_code", undefined)).toBeNull();
});

it("stores the plan a sign-in names and ignores a silent one", () => {
  const sink = { recordWindow: vi.fn(), recordPlan: vi.fn() };
  const handler = registered("claude_code", sink);
  handler?.({ params: { authStatus: { kind: "gateway" } } });
  handler?.({ params: { authStatus: { kind: "other" } } });
  expect(sink.recordPlan).toHaveBeenCalledTimes(1);
  expect(sink.recordPlan).toHaveBeenCalledWith(null);
});

it("logs a failing sink instead of failing the session", () => {
  const failure = new Error("sink");
  const sink = {
    recordWindow: vi.fn(),
    recordPlan: vi.fn(() => {
      throw failure;
    }),
  };
  registered(
    "claude_code",
    sink,
  )?.({
    params: { authStatus: { kind: "api_key" } },
  });
  expect(logCaughtError).toHaveBeenCalledWith("ClaudeAcpQuota", failure);
});
