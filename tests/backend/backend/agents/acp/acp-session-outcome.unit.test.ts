import { afterEach, expect, it, vi } from "vitest";

import { createAcpSessionState } from "@/backend/agents/acp/AcpEvents";
import {
  abortFailure,
  finishAcpTurn,
  stopFailure,
} from "@/backend/agents/acp/AcpSessionOutcome";

const logging = vi.hoisted(() => ({ logEvent: vi.fn() }));

vi.mock("@/backend/logging/Logger", () => logging);

afterEach(() => {
  logging.logEvent.mockReset();
  vi.useRealTimers();
});

function redact(text: string): string {
  return text.replaceAll("secret", "[x]");
}

it.each([
  ["end_turn", null],
  ["cancelled", "cancelled"],
  ["refusal", "failed"],
  ["max_tokens", "incomplete"],
  ["max_turn_requests", "incomplete"],
] as const)("maps the stop reason %s", (reason, failure) => {
  expect(stopFailure(reason)).toBe(failure);
});

it("tells a deadline from a cancellation", () => {
  const timeout = new AbortController();
  timeout.abort(new DOMException("late", "TimeoutError"));
  const stop = new AbortController();
  stop.abort(new DOMException("stop", "AbortError"));

  expect(abortFailure(timeout.signal)).toBe("timeout");
  expect(abortFailure(stop.signal)).toBe("cancelled");
  expect(abortFailure(AbortSignal.abort("plain"))).toBe("cancelled");
});

it("returns the redacted answer and report of a completed turn", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-28T10:00:00.000Z"));
  const state = createAcpSessionState();
  state.sessionId = "secret-session";
  state.text = "answer secret";
  state.permissionDenials = 2;
  state.effective.secretKey = "secret value";
  state.events.push("tool secret completed");
  state.providerFailure = { code: "provider_rate_limited", resetAt: null };

  const turn = finishAcpTurn(
    state,
    { failure: null, errorCode: null, hasHistoryFailure: false },
    redact,
  );

  expect(turn).toEqual({
    output: "answer [x]",
    sessionId: "[x]-session",
    failure: null,
    errorCode: null,
    providerFailure: { code: "provider_rate_limited", resetAt: null },
    endedAt: "2026-10-28T10:00:00.000Z",
    permissionDenials: 2,
    effective: { "[x]Key": "[x] value" },
    events: ["tool [x] completed"],
  });
  expect(logging.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      level: "info",
      metadata: {
        sessionId: "secret-session",
        status: "completed",
        code: null,
      },
    }),
  );
});

it("fails a turn whose answer exceeded the limit", () => {
  const state = createAcpSessionState();
  state.isResultOversized = true;
  state.text = "partial";

  const turn = finishAcpTurn(
    state,
    { failure: null, errorCode: null, hasHistoryFailure: false },
    redact,
  );

  expect(turn).toMatchObject({
    output: "",
    sessionId: null,
    failure: "failed",
    errorCode: "acp_result_limit",
  });
  expect(turn).not.toHaveProperty("providerFailure");
  expect(logging.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({ level: "error" }),
  );
});

it("keeps an earlier failure of an oversized turn", () => {
  const state = createAcpSessionState();
  state.isResultOversized = true;

  expect(
    finishAcpTurn(
      state,
      {
        failure: "cancelled",
        errorCode: "login_cancelled",
        hasHistoryFailure: false,
      },
      redact,
    ),
  ).toMatchObject({ failure: "cancelled", errorCode: "login_cancelled" });
  const cancelled: unknown = expect.objectContaining({ status: "cancelled" });
  expect(logging.logEvent).toHaveBeenCalledWith(
    expect.objectContaining({ level: "info", metadata: cancelled }),
  );
});

it("fails a turn whose persistent history broke", () => {
  const state = createAcpSessionState();
  state.text = "answer";

  expect(
    finishAcpTurn(
      state,
      { failure: null, errorCode: null, hasHistoryFailure: true },
      redact,
    ),
  ).toMatchObject({
    output: "",
    failure: "failed",
    errorCode: "plan_history_unavailable",
  });
});
