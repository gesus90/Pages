import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type { AgentPlanRun } from "@/definition/AgentPlan";

/** The history and the latest command's run, each in the newest state polling knows, so no ended run still reads as running. */
function knownRuns(
  history: readonly AgentPlanRun[],
  latest: AgentPlanRun | undefined,
  polled: AgentPlanRun | undefined,
): readonly AgentPlanRun[] {
  const runs = latest
    ? [latest, ...history.filter((entry) => entry.id !== latest.id)]
    : history;
  return polled
    ? runs.map((entry) => (entry.id === polled.id ? polled : entry))
    : runs;
}

function selectedRun(
  runs: readonly AgentPlanRun[],
  id: string,
  polled: AgentPlanRun | undefined,
): AgentPlanRun | null {
  return (
    runs.find((entry) => entry.id === id) ?? (polled?.id === id ? polled : null)
  );
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
  const polled = poll.data?.ok ? poll.data.run : undefined;
  const runs = knownRuns(history, latest, polled);
  const run = selectedRun(runs, selectedId, polled);
  const hasError = poll.data?.ok === false && poll.data.runId === selectedId;
  useEffect(() => {
    if (latest) {
      select(latest.id);
      void loadRun(
        `/agent-api/plan-runs?runId=${encodeURIComponent(latest.id)}`,
      );
    }
  }, [latest, loadRun]);
  useEffect(() => {
    if (
      !selectedId ||
      (run?.status !== "running" && run?.status !== "paused") ||
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
