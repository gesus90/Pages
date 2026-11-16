import { useEffect, useState } from "react";

import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { RUN_DIAGNOSIS_ENDPOINT } from "@/app/components/agents/runs/run-diagnosis-model";

import { startVisiblePolling } from "../plan-visible-polling";
import { isPlanRunTimeline } from "./plan-run-log-model";

import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentRunTimeline } from "@/definition/AgentRunDiagnosis";

/** How often the log of a running run is read again without a visible change. */
const ACTIVE_READ_INTERVAL_MS = 10_000;

/** What the log knows of the shown run. */
export interface PlanRunLogState {
  /** The timeline of exactly the shown run, or `null` before its first answer. */
  readonly timeline: AgentRunTimeline | null;
  readonly isFailed: boolean;
}

interface StoredRead {
  readonly runId: string;
  readonly timeline: AgentRunTimeline | null;
  readonly isFailed: boolean;
}

/** Changes whenever the shown run records a step change, so its log is read again. */
function runProgressKey(run: AgentPlanRun): string {
  return JSON.stringify([
    run.status,
    run.endedAt ?? null,
    run.steps.map((step) => [
      step.id,
      step.status,
      step.isBlocked,
      step.activation ?? 0,
      step.history?.length ?? 0,
    ]),
    run.loops?.length ?? 0,
  ]);
}

async function readTimeline(
  runId: string,
  signal: AbortSignal,
): Promise<AgentRunTimeline> {
  const query = new URLSearchParams({ view: "timeline", runId });
  const response = await fetch(
    `${RUN_DIAGNOSIS_ENDPOINT}?${query.toString()}`,
    { signal, cache: "no-store" },
  );
  const body: unknown = await response.json();
  if (!response.ok || !isPlanRunTimeline(body, runId))
    throw new Error("Run log could not be read");
  return body;
}

/**
 * Reads the recorded timeline of the run the canvas shows.
 * @param run - The shown run; `null` reads nothing.
 * @remarks
 * An answer counts only for the run it was asked for: after a switch to
 * another plan or run the log is empty until that run answers, so no message
 * of another run stays visible. A running run is read again on every step
 * change and at a fixed interval while the tab is visible. Reading never
 * changes the run.
 */
export function usePlanRunLog(run: AgentPlanRun | null): PlanRunLogState {
  const [stored, setStored] = useState<StoredRead | null>(null);
  const runId = run?.id ?? null;
  const progressKey = run ? runProgressKey(run) : null;
  const isActive = run !== null && isActivePlanRun(run.status);
  useEffect(() => {
    if (runId === null || progressKey === null) return;
    const controller = new AbortController();
    async function read(): Promise<number | null> {
      if (runId === null) return null;
      try {
        const timeline = await readTimeline(runId, controller.signal);
        setStored({ runId, timeline, isFailed: false });
      } catch (error: unknown) {
        if (controller.signal.aborted) return null;
        console.warn("plan run log read failed", error);
        setStored((previous) => ({
          runId,
          timeline: previous?.runId === runId ? previous.timeline : null,
          isFailed: true,
        }));
      }
      return isActive ? ACTIVE_READ_INTERVAL_MS : null;
    }
    const stop = startVisiblePolling(read);
    return () => {
      stop();
      controller.abort();
    };
  }, [runId, progressKey, isActive]);
  if (runId === null || stored?.runId !== runId)
    return { timeline: null, isFailed: false };
  return { timeline: stored.timeline, isFailed: stored.isFailed };
}
