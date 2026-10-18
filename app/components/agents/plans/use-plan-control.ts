import { usePlanPoll } from "./use-plan-poll";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";

/** Polls server-owned actions even when idle, so other tabs and shared readers reconnect correctly. */
export function usePlanControl(
  planId: string | undefined,
  initial: AgentPlanControl | undefined,
  command: AgentPlanActionResult | undefined,
): {
  readonly control: AgentPlanControl | undefined;
  readonly error: string | null;
} {
  const poll = usePlanPoll(
    planId ? `/agent-api/plan-runs?planId=${encodeURIComponent(planId)}` : null,
    command,
  );
  return {
    control: poll.response?.ok ? (poll.response.control ?? initial) : initial,
    error: poll.error,
  };
}
