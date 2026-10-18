import { useEffect, useState } from "react";

import { readPlanPollingResponse } from "@/app/lib/agent-plan-poll";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";

interface PlanPollState {
  readonly url: string | null;
  readonly response: AgentPlanActionResult | undefined;
  readonly error: string | null;
}

/** A dropped connection keeps the editor mounted and retries without replaying a mutation. */
export function usePlanPoll(
  url: string | null,
  refresh: AgentPlanActionResult | undefined,
  mode: "always" | "active" = "always",
): Omit<PlanPollState, "url"> {
  const [state, setState] = useState<PlanPollState>({
    url: null,
    response: undefined,
    error: null,
  });
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    let timer: number | undefined;
    async function poll(): Promise<void> {
      let shouldContinue = true;
      try {
        const response = await fetch(url ?? "", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        const result = readPlanPollingResponse(payload);
        if (controller.signal.aborted) return;
        setState({
          url,
          response: result,
          error: result.ok ? null : result.error,
        });
        if (mode === "active" && result.ok && result.run)
          shouldContinue = isActivePlanRun(result.run.status);
      } catch {
        if (controller.signal.aborted) return;
        // Network and invalid-response failures are retryable; stale actions stay disabled.
        setState((previous) => ({
          url,
          response: previous.url === url ? previous.response : undefined,
          error: "plan_connection_unavailable",
        }));
      } finally {
        if (!controller.signal.aborted && shouldContinue)
          timer = window.setTimeout(() => {
            void poll();
          }, 1000);
      }
    }
    void poll();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [url, refresh, mode]);
  return state.url === url ? state : { response: undefined, error: null };
}
