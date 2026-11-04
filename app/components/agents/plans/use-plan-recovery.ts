import { useEffect, useRef, useState } from "react";

import { createRandomUuid } from "@/app/lib/random-uuid";
import { readPlanCleanupFailure } from "@/definition/AgentPlanCleanupResource";

import { startVisiblePolling } from "./plan-visible-polling";

import type {
  AgentPlanRecoveryCommand,
  AgentPlanRecoveryResult,
  AgentPlanRecoveryView,
} from "@/definition/AgentPlanRecovery";
import type { AgentPlanCleanupFailure } from "@/definition/AgentPlanCleanupResource";

const RECOVERY_POLL_MILLISECONDS = 5_000;

/** A command without the revision and key, which the hook adds itself. */
export type PlanRecoveryRequest = AgentPlanRecoveryCommand extends infer Command
  ? Command extends AgentPlanRecoveryCommand
    ? Omit<Command, "expectedRevision" | "idempotencyKey">
    : never
  : never;

/** What decides beyond the view of the run when the view is read again. */
export interface PlanRecoveryFollowing {
  /** The run has not ended yet, so its view is read cyclically. */
  readonly isRunActive: boolean;
  /** A new value reads the view once, because a change of it may change the options. */
  readonly readKey: string;
  /** Reports the end of a decision, which may have changed the control. */
  readonly onDecided: () => void;
}

interface RecoveryDecision {
  readonly fingerprint: string;
  readonly key: string;
  revision: number | null;
  planRevision: number | null;
}

interface RecoveryState {
  readonly runId: string | null;
  readonly view: AgentPlanRecoveryView | null;
  readonly error: string | null;
  readonly cleanupFailure: AgentPlanCleanupFailure | null;
}

const NO_FOLLOWING: PlanRecoveryFollowing = {
  isRunActive: false,
  readKey: "",
  onDecided: () => undefined,
};

class RecoveryRequestError extends Error {
  public readonly cleanupFailure: AgentPlanCleanupFailure | null;
  public readonly status: number;

  public constructor(
    code: string,
    failure: AgentPlanCleanupFailure | null,
    status: number,
  ) {
    super(code);
    this.cleanupFailure = failure;
    this.status = status;
  }
}

function isRecoveryView(input: unknown): input is AgentPlanRecoveryView {
  return (
    typeof input === "object" &&
    input !== null &&
    "runId" in input &&
    "restart" in input &&
    "resume" in input
  );
}

function readFailure(payload: unknown, status: number): RecoveryRequestError {
  const code =
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
      ? payload.error
      : "plan_connection_unavailable";
  const failure =
    code === "cleanup_unconfirmed" &&
    typeof payload === "object" &&
    payload !== null &&
    "cleanupFailure" in payload
      ? readPlanCleanupFailure(payload.cleanupFailure)
      : null;
  return new RecoveryRequestError(code, failure, status);
}

function isRecoveryResult(input: unknown): input is AgentPlanRecoveryResult {
  return (
    typeof input === "object" &&
    input !== null &&
    "outcome" in input &&
    typeof input.outcome === "string"
  );
}

/** Sends one decision with the revision the executor saw and a fresh key. */
async function sendDecision(
  runId: string,
  revision: number,
  request: PlanRecoveryRequest,
  idempotencyKey: string,
): Promise<AgentPlanRecoveryResult> {
  const response = await fetch(
    `/agent-api/plan-runs/${encodeURIComponent(runId)}/recovery`,
    {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...request,
        expectedRevision: revision,
        idempotencyKey,
      }),
    },
  );
  const payload: unknown = await response.json();
  const answered =
    typeof payload === "object" && payload !== null && "result" in payload
      ? payload.result
      : null;
  if (!response.ok || !isRecoveryResult(answered))
    throw readFailure(payload, response.status);
  return answered;
}

async function loadView(
  runId: string,
  signal: AbortSignal,
): Promise<AgentPlanRecoveryView> {
  const response = await fetch(
    `/agent-api/plan-runs/${encodeURIComponent(runId)}/recovery`,
    { cache: "no-store", signal },
  );
  const payload: unknown = await response.json();
  const recovery =
    typeof payload === "object" && payload !== null && "recovery" in payload
      ? payload.recovery
      : null;
  if (!response.ok || !isRecoveryView(recovery))
    throw readFailure(payload, response.status);
  return recovery;
}

/** Refreshes a changing run inside the chosen action, with one bounded retry for progress-only revisions. */
async function decideCurrent(input: {
  readonly runId: string;
  readonly request: PlanRecoveryRequest;
  readonly decision: RecoveryDecision;
}): Promise<AgentPlanRecoveryResult> {
  const signal = new AbortController().signal;
  if (input.decision.revision === null) {
    const current = await loadView(input.runId, signal);
    input.decision.revision = current.revision;
    input.decision.planRevision = current.currentPlanRevision;
  }
  try {
    return await sendDecision(
      input.runId,
      input.decision.revision,
      input.request,
      input.decision.key,
    );
  } catch (error: unknown) {
    if (!(error instanceof Error) || error.message !== "revision_conflict")
      throw error;
    const refreshed = await loadView(input.runId, signal);
    if (input.decision.planRevision !== refreshed.currentPlanRevision)
      throw error;
    input.decision.revision = refreshed.revision;
    return sendDecision(
      input.runId,
      refreshed.revision,
      input.request,
      input.decision.key,
    );
  }
}

/**
 * Reads what can happen to an ended run and sends the executor's decision.
 *
 * @param runId - The newest run of the plan, or `null` when there is none to recover.
 * @param onStarted - Selects a run that a restart or resume started.
 * @param following - What decides beyond the view when it is read again.
 *
 * @remarks
 * Each decision carries the revision the executor saw and a fresh key, so a
 * double click or a repeated request starts nothing twice. The view is read
 * again after every decision and after a reload, from the server's state.
 * It is read cyclically only while the run has not ended or its cleanup is
 * open, and while a failed read may still succeed.
 */
export function usePlanRecovery(
  runId: string | null,
  onStarted: (runId: string) => void,
  following: PlanRecoveryFollowing = NO_FOLLOWING,
): {
  readonly view: AgentPlanRecoveryView | null;
  readonly error: string | null;
  readonly cleanupFailure: AgentPlanCleanupFailure | null;
  readonly isPending: boolean;
  readonly result: AgentPlanRecoveryResult | null;
  /** Sends the decision; resolves with the server's answer, or `null` when it was refused. */
  readonly submit: (
    request: PlanRecoveryRequest,
  ) => Promise<AgentPlanRecoveryResult | null>;
} {
  const inFlight = useRef(false);
  const decision = useRef<RecoveryDecision | null>(null);
  const [state, setState] = useState<RecoveryState>({
    runId: null,
    view: null,
    error: null,
    cleanupFailure: null,
  });
  const [isPending, setPending] = useState(false);
  const [result, setResult] = useState<{
    readonly runId: string;
    readonly value: AgentPlanRecoveryResult;
  } | null>(null);
  const [generation, setGeneration] = useState(0);
  useRecoveryRefresh(
    runId,
    `${generation}:${following.readKey}`,
    following.isRunActive,
    setState,
  );
  const current = state.runId === runId ? state : null;
  async function submit(
    request: PlanRecoveryRequest,
  ): Promise<AgentPlanRecoveryResult | null> {
    const view = current?.view;
    if (!runId || !view || inFlight.current) return null;
    inFlight.current = true;
    const fingerprint = JSON.stringify([runId, request]);
    if (decision.current?.fingerprint !== fingerprint)
      decision.current = {
        fingerprint,
        key: `ui-${createRandomUuid()}`,
        revision: view.revision,
        planRevision: view.currentPlanRevision,
      };
    setPending(true);
    setResult(null);
    setState({ runId, view, error: null, cleanupFailure: null });
    try {
      const answered = await decideCurrent({
        runId,
        request,
        decision: decision.current,
      });
      decision.current = null;
      setResult({ runId, value: answered });
      setState({ runId, view, error: null, cleanupFailure: null });
      if (answered.runId) onStarted(answered.runId);
      return answered;
    } catch (error: unknown) {
      setState({
        runId,
        view,
        error:
          error instanceof Error
            ? error.message
            : "plan_connection_unavailable",
        cleanupFailure:
          error instanceof RecoveryRequestError ? error.cleanupFailure : null,
      });
      return null;
    } finally {
      inFlight.current = false;
      setPending(false);
      setGeneration((value) => value + 1);
      following.onDecided();
    }
  }
  return {
    view: current?.view ?? null,
    error: current?.error ?? null,
    cleanupFailure: current?.cleanupFailure ?? null,
    isPending,
    result: result?.runId === runId ? result.value : null,
    submit,
  };
}

function useRecoveryRefresh(
  runId: string | null,
  readKey: string,
  isRunActive: boolean,
  setState: React.Dispatch<React.SetStateAction<RecoveryState>>,
): void {
  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    async function load(id: string): Promise<number | null> {
      const startedAt = Date.now();
      let shouldRepeat = isRunActive;
      try {
        const view = await loadView(id, controller.signal);
        shouldRepeat ||= view.isCleanupUnconfirmed;
        setState((previous) => ({
          runId: id,
          view,
          error: previous.runId === id ? previous.error : null,
          cleanupFailure:
            previous.runId === id ? previous.cleanupFailure : null,
        }));
      } catch (error: unknown) {
        if (controller.signal.aborted) return null;
        // A refusal stays one until something changes; a failed connection or server may recover.
        shouldRepeat =
          !(error instanceof RecoveryRequestError) || error.status >= 500;
        setState({
          runId: id,
          view: null,
          error:
            error instanceof Error
              ? error.message
              : "plan_connection_unavailable",
          cleanupFailure: null,
        });
      }
      return shouldRepeat
        ? Math.max(0, RECOVERY_POLL_MILLISECONDS - (Date.now() - startedAt))
        : null;
    }
    const stopPolling = startVisiblePolling(() => load(runId));
    return () => {
      controller.abort();
      stopPolling();
    };
  }, [runId, readKey, isRunActive, setState]);
}
