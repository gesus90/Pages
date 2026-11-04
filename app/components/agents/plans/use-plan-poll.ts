import { useEffect, useState } from "react";

import { readPlanPollingResponse } from "@/app/lib/agent-plan-poll";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import { startVisiblePolling } from "./plan-visible-polling";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";

const ACTIVE_POLL_MILLISECONDS = 2_000;
// One read of the ended run joins the reads of an open page: 19 reads at this pace keep five minutes at 20.
const IDLE_POLL_MILLISECONDS = 16_000;

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

/** Whether an answer names an active run; a refusal or an answer without a run names none. */
function namesActiveRun(result: AgentPlanActionResult): boolean {
  if (!result.ok) return false;
  const status = result.run?.status ?? result.control?.status;
  return status !== undefined && isActivePlanRun(status);
}

/**
 * Follows an address while the tab is visible; a dropped connection keeps the editor mounted and retries without replaying a mutation.
 *
 * @param url - The address to read, or `null` when there is nothing to read.
 * @param refresh - The latest command; a new one reads at once and drops the earlier answer.
 * @param mode - `active` ends the reads with the run, `always` keeps reading and observing.
 * @param readRequest - A new value reads at once and keeps the earlier answer until the new one.
 *
 * @remarks
 * The pace is two seconds while the last answer names an active run and also
 * before the first answer, otherwise 16 seconds.
 */
export function usePlanPoll(
  url: string | null,
  refresh: AgentPlanActionResult | undefined,
  mode: "always" | "active" = "always",
  readRequest = 0,
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
    let etag: string | null = null;
    let isOpening = true;
    let isRunActive = true;
    async function poll(wasHidden: boolean): Promise<number | null> {
      const startedAt = Date.now();
      let shouldContinue = true;
      // The viewer lease may have run out meanwhile; opening asks remote runners for current progress.
      if (wasHidden) isOpening = true;
      try {
        const response = await fetch(target, {
          cache: "no-store",
          signal: controller.signal,
          headers: pollingHeaders(mode, etag, isOpening),
        });
        if (controller.signal.aborted) return null;
        isOpening = false;
        if (response.status === 304) {
          setState((previous) =>
            previous.url === target && previous.refresh === refresh
              ? { ...previous, error: null }
              : previous,
          );
        } else {
          const payload: unknown = await response.json();
          const result = readPlanPollingResponse(payload);
          etag = result.ok ? response.headers.get("ETag") : null;
          if (controller.signal.aborted) return null;
          setState({
            url: target,
            refresh,
            response: result,
            error: result.ok ? null : result.error,
          });
          isRunActive = namesActiveRun(result);
          if (mode === "active" && result.ok && result.run)
            shouldContinue = isRunActive;
        }
      } catch {
        if (controller.signal.aborted) return null;
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
      }
      if (!shouldContinue) return null;
      const interval = isRunActive
        ? ACTIVE_POLL_MILLISECONDS
        : IDLE_POLL_MILLISECONDS;
      return Math.max(0, interval - (Date.now() - startedAt));
    }
    const stopPolling = startVisiblePolling(poll);
    return () => {
      controller.abort();
      stopPolling();
    };
  }, [url, refresh, mode, readRequest]);
  const current = {
    url: state.url,
    response: state.response,
    error: state.error,
  };
  return state.url === url && state.refresh === refresh
    ? current
    : { response: undefined, error: null };
}
