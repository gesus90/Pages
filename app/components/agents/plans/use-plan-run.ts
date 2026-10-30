import { useEffect, useState } from "react";

import { usePlanPoll } from "./use-plan-poll";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";

interface RunContext {
  readonly planId: string | undefined;
  readonly control: AgentPlanControl | undefined;
  readonly controlError: string | null;
}

interface RunSelection {
  readonly planId: string | undefined;
  readonly id: string;
  readonly mode: "follow" | "history";
  readonly basisId: string;
  readonly command: AgentPlanActionResult | undefined;
}

interface RunReadAccess {
  readonly url: string | null;
  readonly isMissing: boolean;
  readonly error: string | null;
}

function scopedHistory(
  history: readonly AgentPlanRun[],
  planId: string | undefined,
): readonly AgentPlanRun[] {
  return history.every((entry) => entry.planId === planId)
    ? history
    : history.filter((entry) => entry.planId === planId);
}

function currentRunId(
  history: readonly AgentPlanRun[],
  control: AgentPlanControl | undefined,
): string {
  return control ? (control.runId ?? "") : (history[0]?.id ?? "");
}

function runReadAccess(
  context: RunContext,
  selection: RunSelection | null,
  id: string,
  history: readonly AgentPlanRun[],
): RunReadAccess {
  const isMissing =
    selection !== null &&
    selection.planId === context.planId &&
    selection.mode === "history" &&
    !history.some((entry) => entry.id === id);
  const isDenied = context.control?.issue === "plan_access_denied";
  const error = context.controlError ?? (isDenied ? "accessDenied" : null);
  return {
    url:
      id && !isMissing && !error
        ? `/agent-api/plan-runs?runId=${encodeURIComponent(id)}`
        : null,
    isMissing,
    error,
  };
}

function followingId(
  selection: RunSelection | null,
  planId: string | undefined,
  currentId: string,
): string {
  if (!selection || selection.planId !== planId) return currentId;
  if (selection.mode === "history") return selection.id;
  // A confirmed local action may precede the next control poll; later control changes win.
  return selection.basisId === currentId ? selection.id : currentId;
}

/** The history and the latest command's run, each in the newest state polling knows, so no ended run still reads as running. */
function knownRuns(
  history: readonly AgentPlanRun[],
  latest: AgentPlanRun | undefined,
  polled: AgentPlanRun | undefined,
): readonly AgentPlanRun[] {
  const runs = latest
    ? [latest, ...history.filter((entry) => entry.id !== latest.id)]
    : history;
  const updated = polled ? mergePolledRun(runs, polled) : runs;
  if (updated === history) return history;
  return [...updated].sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  );
}

function mergePolledRun(
  runs: readonly AgentPlanRun[],
  polled: AgentPlanRun,
): readonly AgentPlanRun[] {
  return runs.some((entry) => entry.id === polled.id)
    ? runs.map((entry) => (entry.id === polled.id ? polled : entry))
    : [polled, ...runs];
}

function commandRun(
  command: AgentPlanActionResult | undefined,
  planId: string | undefined,
): AgentPlanRun | undefined {
  return command?.ok && command.run?.planId === planId
    ? command.run
    : undefined;
}

function matchingPolledRun(
  response: AgentPlanActionResult | undefined,
  planId: string | undefined,
  id: string,
): AgentPlanRun | undefined {
  if (!response?.ok) return undefined;
  const run = response.run;
  return run?.planId === planId && run?.id === id ? run : undefined;
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

/** Follows current own control unless history was deliberately selected; denied context hides cached content. */
export function usePlanRun(
  history: readonly AgentPlanRun[],
  command: AgentPlanActionResult | undefined,
  context: RunContext,
): {
  readonly run: AgentPlanRun | null;
  readonly selectedId: string;
  readonly select: (id: string, mode: "follow" | "history") => void;
  readonly runs: readonly AgentPlanRun[];
  readonly error: string | null;
} {
  const { planId, control } = context;
  const ownHistory = scopedHistory(history, planId);
  const currentId = currentRunId(ownHistory, control);
  const [selection, setSelection] = useState<RunSelection | null>(null);
  const selectedId = followingId(selection, planId, currentId);
  const access = runReadAccess(context, selection, selectedId, ownHistory);
  const poll = usePlanPoll(access.url, command, "active");
  const latest = commandRun(command, planId);
  const polled = matchingPolledRun(poll.response, planId, selectedId);
  const runs = knownRuns(ownHistory, latest, polled);
  const run = selectedRun(runs, selectedId, polled);
  const error = access.error ?? poll.error;
  function select(id: string, mode: "follow" | "history"): void {
    setSelection({
      planId,
      id,
      mode: id === currentId ? "follow" : mode,
      basisId: currentId,
      command,
    });
  }
  useEffect(() => {
    if (!latest) return;
    setSelection((previous) =>
      previous !== null &&
      previous.planId === planId &&
      previous.command === command
        ? previous
        : {
            planId,
            id: latest.id,
            mode: "follow",
            basisId: currentId,
            command,
          },
    );
  }, [latest, command, currentId, planId]);
  return {
    run: error || access.isMissing ? null : run,
    selectedId,
    select,
    runs: error ? [] : runs,
    error,
  };
}
