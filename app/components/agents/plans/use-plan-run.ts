import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type { AgentPlanRun } from "@/definition/AgentPlan";

function selectedRun(
  runs: readonly AgentPlanRun[],
  id: string,
  polled: AgentPlanActionResult | undefined,
): AgentPlanRun | null {
  if (polled?.ok && polled.run?.id === id) return polled.run;
  return runs.find((entry) => entry.id === id) ?? null;
}

/** Polling follows one own run and stops on completion, permission loss or unmount. */
export function usePlanRun(
  history: readonly AgentPlanRun[],
  command: AgentPlanActionResult | undefined,
): {
  readonly run: AgentPlanRun | null;
  readonly selectedId: string;
  readonly select: (id: string) => void;
  readonly runs: readonly AgentPlanRun[];
  readonly error: string | null;
} {
  const [selectedId, select] = useState(history[0]?.id ?? "");
  const poll = useFetcher<AgentPlanActionResult>();
  const { load: loadRun } = poll;
  const latest = command?.ok ? command.run : undefined;
  const runs = latest
    ? [latest, ...history.filter((entry) => entry.id !== latest.id)]
    : history;
  const run = selectedRun(runs, selectedId, poll.data);
  const hasError = poll.data?.ok === false && poll.data.runId === selectedId;
  useEffect(() => {
    if (latest) select(latest.id);
  }, [latest]);
  useEffect(() => {
    if (
      !selectedId ||
      run?.status !== "running" ||
      hasError ||
      poll.state !== "idle"
    )
      return undefined;
    const interval = window.setInterval(() => {
      void loadRun(
        `/agent-api/plan-runs?runId=${encodeURIComponent(selectedId)}`,
      );
    }, 1000);
    return () => window.clearInterval(interval);
  }, [selectedId, run?.status, hasError, loadRun, poll.state]);
  return {
    run: hasError ? null : run,
    selectedId,
    select,
    runs,
    error: hasError && poll.data?.ok === false ? poll.data.error : null,
  };
}
