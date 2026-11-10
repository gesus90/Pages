import { RequestError } from "@agentclientprotocol/sdk";

import { diagnosticProviderFailure } from "@/backend/agents/AgentProviderFailure";
import { noteSessionEvent } from "@/backend/agents/cli/CliSessionEvents";
import { AgentError } from "@/backend/error/AgentErrors";
import { logEvent } from "@/backend/logging/Logger";

import { noteAcpStderr } from "./AcpEvents";
import {
  classifyOpenCodeFailure,
  openCodeAcpFailure,
} from "./OpenCodeAcpErrors";

import type { CliSessionExit } from "@/backend/agents/cli/CliSessionProcess";
import type { AcpDriver } from "./AcpDriver";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { StopReason } from "@agentclientprotocol/sdk";
import type { PlanSessionTurn } from "@/backend/agents/AgentPlanExecution";
import type { AcpSessionState } from "./AcpEvents";

/** The JSON-RPC code with which an adapter asks for a sign-in. */
const AUTH_REQUIRED = -32000;

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

/**
 * Classifies native process diagnostics without persisting potentially sensitive stderr.
 *
 * @remarks
 * A generic ACP session code must not hide a permanent inner cause such as an
 * authentication, model, policy or quota failure. The outer code is returned
 * only when the inner diagnostic names no more specific cause.
 */
export function classifiedAcpFailure(
  driver: Pick<AcpDriver, "errors">,
  text: string,
): AgentErrorCode {
  const code = classifyOpenCodeFailure(text);
  return code === "opencode_acp_session_failed"
    ? driver.errors.sessionFailed
    : code;
}

/** Retains the existing name for the disconnected-process path. */
export function disconnectedAcpFailure(
  driver: Pick<AcpDriver, "provider" | "errors">,
  stderr: string,
): AgentErrorCode {
  return classifiedAcpFailure(driver, stderr);
}

/**
 * Classifies an error that ended a turn nobody stopped.
 *
 * @param error - The error of the turn.
 * @param state - The session state; a provider failure is kept in it.
 * @param driver - The driver of the session.
 * @param isDisconnected - Whether the connection to the adapter ended.
 * @returns The error code of the turn, or `null` when the connection ended
 * and the exit of the process decides.
 */
export function acpErrorFailure(
  error: unknown,
  state: AcpSessionState,
  driver: Pick<AcpDriver, "provider" | "errors">,
  isDisconnected: boolean,
): AgentErrorCode | null {
  if (error instanceof AgentError) return error.code;
  const providerFailure =
    diagnosticProviderFailure(error) ?? state.providerFailure;
  if (providerFailure) {
    state.providerFailure = providerFailure;
    return providerFailure.code;
  }
  if (isDisconnected) return null;
  if (driver.provider === "opencode") {
    const code = openCodeAcpFailure(error);
    noteSessionEvent(state.events, `OpenCode failure: ${code}`);
    return code;
  }
  if (error instanceof RequestError && error.code === AUTH_REQUIRED)
    return "cli_not_logged_in";
  const diagnostic = error instanceof Error ? error.message : "unknown";
  noteSessionEvent(state.events, `error ${diagnostic}`);
  return classifiedAcpFailure(driver, diagnostic);
}

/**
 * Tells how a turn ended whose adapter process went away.
 *
 * @param exit - The exit of the process.
 * @param state - The session state that receives the redacted error stream.
 * @param driver - The driver of the session.
 * @param options - Whether the native Pica build ran, whose error stream stays
 * out of the record, and the redaction of the session.
 */
export function disconnectedAcpOutcome(
  exit: CliSessionExit,
  state: AcpSessionState,
  driver: Pick<AcpDriver, "provider" | "errors">,
  options: {
    readonly isPicaNative: boolean;
    readonly redact: (line: string) => string;
  },
): {
  readonly failure: PlanSessionTurn["failure"];
  readonly errorCode: AgentErrorCode | null;
} {
  // The deadline of the process itself can fire before the one of the node.
  if (exit.errorCode === "check_timeout")
    return { failure: "timeout", errorCode: null };
  if (
    exit.errorCode === "acp_worker_limit" ||
    exit.errorCode === "acp_output_overflow" ||
    exit.errorCode === "acp_input_too_large"
  )
    return { failure: "failed", errorCode: exit.errorCode };
  if (
    !options.isPicaNative &&
    !["opencode", "antigravity"].includes(driver.provider)
  )
    noteAcpStderr(state, exit.stderrTail, options.redact);
  return {
    failure: "failed",
    errorCode: disconnectedAcpFailure(
      driver,
      options.isPicaNative ? "" : exit.stderrTail,
    ),
  };
}
