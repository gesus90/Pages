import { useEffect, useState } from "react";

import { usePlanPoll } from "./use-plan-poll";

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

/** Polling follows one own run and stops on completion or unmount; access errors hide its view. */
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
  const poll = usePlanPoll(
    selectedId
      ? `/agent-api/plan-runs?runId=${encodeURIComponent(selectedId)}`
      : null,
    command,
    "active",
  );
  const latest = command?.ok ? command.run : undefined;
  const polled = poll.response?.ok ? poll.response.run : undefined;
  const runs = knownRuns(history, latest, polled);
  const run = selectedRun(runs, selectedId, polled);
  useEffect(() => {
    if (latest) select(latest.id);
  }, [latest]);
  return {
    run: poll.error ? null : run,
    selectedId,
    select,
    runs,
    error: poll.error,
  };
}
