import type { StopReason } from "@agentclientprotocol/sdk";
import type { PlanSessionTurn } from "@/backend/agents/AgentPlanExecution";

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
