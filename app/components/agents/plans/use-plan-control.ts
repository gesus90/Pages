import { useState } from "react";

import { usePlanPoll } from "./use-plan-poll";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";

/**
 * Polls server-owned actions even when idle, so other tabs and shared readers reconnect correctly.
 *
 * @param planId - The saved plan, `undefined` while it is unsaved.
 * @param initial - The control of the page loader, until polling answers.
 * @param command - The latest command, which reads at once.
 */
export function usePlanControl(
  planId: string | undefined,
  initial: AgentPlanControl | undefined,
  command: AgentPlanActionResult | undefined,
): {
  readonly control: AgentPlanControl | undefined;
  readonly error: string | null;
  /** Reads at once after an own action that `command` does not report. */
  readonly readAgain: () => void;
} {
  const [readRequest, setReadRequest] = useState(0);
  const poll = usePlanPoll(
    planId ? `/agent-api/plan-runs?planId=${encodeURIComponent(planId)}` : null,
    command,
    "always",
    readRequest,
  );
  return {
    control: poll.response?.ok ? (poll.response.control ?? initial) : initial,
    error: poll.error,
    readAgain: () => setReadRequest((request) => request + 1),
  };
}
