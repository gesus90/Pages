import { logEvent } from "@/backend/logging/Logger";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { StopReason } from "@agentclientprotocol/sdk";
import type { PlanSessionTurn } from "@/backend/agents/AgentPlanExecution";
import type { AcpSessionState } from "./AcpEvents";

/** Maps a protocol stop reason to the existing run outcome. */
export function stopFailure(reason: StopReason): PlanSessionTurn["failure"] {
  switch (reason) {
    case "end_turn":
      return null;
    case "cancelled":
      return "cancelled";
    case "refusal":
      return "failed";
    case "max_tokens":
    case "max_turn_requests":
      return "incomplete";
  }
}

/** Distinguishes a deadline from an explicit cancellation. */
export function abortFailure(signal: AbortSignal): "timeout" | "cancelled" {
  return signal.reason instanceof DOMException &&
    signal.reason.name === "TimeoutError"
    ? "timeout"
    : "cancelled";
}

/** Finishes a native turn only with a bounded final answer and healthy persistent history. */
export function finishAcpTurn(
  state: AcpSessionState,
  outcome: {
    readonly failure: PlanSessionTurn["failure"];
    readonly errorCode: AgentErrorCode | null;
    readonly hasHistoryFailure: boolean;
  },
  redact: (text: string) => string,
): PlanSessionTurn {
  let { failure, errorCode } = outcome;
  if (outcome.hasHistoryFailure) {
    failure = "failed";
    errorCode = "plan_history_unavailable";
  }
  if (state.isResultOversized && failure === null) {
    failure = "failed";
    errorCode = "acp_result_limit";
  }
  logEvent({
    level: failure === "failed" ? "error" : "info",
    event: "acp.turn.completed",
    component: "AcpSession",
    message: "ACP turn ended",
    metadata: {
      sessionId: state.sessionId,
      status: failure ?? "completed",
      code: errorCode,
    },
  });
  return {
    output:
      state.isResultOversized || outcome.hasHistoryFailure
        ? ""
        : redact(state.text),
    sessionId: state.sessionId === null ? null : redact(state.sessionId),
    failure,
    errorCode,
    ...(state.providerFailure
      ? { providerFailure: state.providerFailure }
      : {}),
    endedAt: new Date().toISOString(),
    permissionDenials: state.permissionDenials,
    effective: Object.fromEntries(
      Object.entries(state.effective).map(([key, value]) => [
        redact(key),
        redact(value),
      ]),
    ),
    events: state.events.map((event) => redact(event)),
  };
}
