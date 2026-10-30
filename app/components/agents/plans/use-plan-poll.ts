import { useEffect, useState } from "react";

import { readPlanPollingResponse } from "@/app/lib/agent-plan-poll";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";

interface PlanPollState {
  readonly url: string | null;
  readonly refresh: AgentPlanActionResult | undefined;
  readonly response: AgentPlanActionResult | undefined;
  readonly error: string | null;
}

function pollingHeaders(
  mode: "always" | "active",
  etag: string | null,
  isOpening: boolean,
): HeadersInit {
  return {
    ...(etag ? { "If-None-Match": etag } : {}),
    ...(mode === "always"
      ? { "X-Plan-Observation": isOpening ? "open" : "renew" }
      : {}),
  };
}

/** A dropped connection keeps the editor mounted and retries without replaying a mutation. */
export function usePlanPoll(
  url: string | null,
  refresh: AgentPlanActionResult | undefined,
  mode: "always" | "active" = "always",
): Pick<PlanPollState, "response" | "error"> {
  const [state, setState] = useState<PlanPollState>({
    url: null,
    refresh: undefined,
    response: undefined,
    error: null,
  });
  useEffect(() => {
    if (!url) return;
    const target = url;
    const controller = new AbortController();
    let timer: number | undefined;
    let etag: string | null = null;
    let isOpening = true;
    async function poll(): Promise<void> {
      const startedAt = Date.now();
      let shouldContinue = true;
      try {
        const response = await fetch(target, {
          cache: "no-store",
          signal: controller.signal,
          headers: pollingHeaders(mode, etag, isOpening),
        });
        if (controller.signal.aborted) return;
        isOpening = false;
        if (response.status === 304) {
          setState((previous) =>
            previous.url === target && previous.refresh === refresh
              ? { ...previous, error: null }
              : previous,
          );
          return;
        }
        const payload: unknown = await response.json();
        const result = readPlanPollingResponse(payload);
        etag = result.ok ? response.headers.get("ETag") : null;
        if (controller.signal.aborted) return;
        setState({
          url: target,
          refresh,
          response: result,
          error: result.ok ? null : result.error,
        });
        if (mode === "active" && result.ok && result.run)
          shouldContinue = isActivePlanRun(result.run.status);
      } catch {
        if (controller.signal.aborted) return;
        // Network and invalid-response failures are retryable; stale actions stay disabled.
        setState((previous) => ({
          url: target,
          refresh,
          response:
            previous.url === target && previous.refresh === refresh
              ? previous.response
              : undefined,
          error: "plan_connection_unavailable",
        }));
      } finally {
        if (!controller.signal.aborted && shouldContinue)
          timer = window.setTimeout(
            () => {
              void poll();
            },
            Math.max(0, 2000 - (Date.now() - startedAt)),
          );
      }
    }
    void poll();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [url, refresh, mode]);
  const current = {
    url: state.url,
    response: state.response,
    error: state.error,
  };
  return state.url === url && state.refresh === refresh
    ? current
    : { response: undefined, error: null };
}
