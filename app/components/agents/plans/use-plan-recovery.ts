import { useEffect, useState } from "react";

import { createRandomUuid } from "@/app/lib/random-uuid";
import { readPlanCleanupFailure } from "@/definition/AgentPlanCleanupResource";

import type {
  AgentPlanRecoveryCommand,
  AgentPlanRecoveryResult,
  AgentPlanRecoveryView,
} from "@/definition/AgentPlanRecovery";
import type { AgentPlanCleanupFailure } from "@/definition/AgentPlanCleanupResource";

/** A command without the revision and key, which the hook adds itself. */
export type PlanRecoveryRequest = AgentPlanRecoveryCommand extends infer Command
  ? Command extends AgentPlanRecoveryCommand
    ? Omit<Command, "expectedRevision" | "idempotencyKey">
    : never
  : never;

interface RecoveryState {
  readonly runId: string | null;
  readonly view: AgentPlanRecoveryView | null;
  readonly error: string | null;
  readonly cleanupFailure: AgentPlanCleanupFailure | null;
}

class RecoveryRequestError extends Error {
  public readonly cleanupFailure: AgentPlanCleanupFailure | null;

  public constructor(code: string, failure: AgentPlanCleanupFailure | null) {
    super(code);
    this.cleanupFailure = failure;
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

function readFailure(payload: unknown): RecoveryRequestError {
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
  return new RecoveryRequestError(code, failure);
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
        idempotencyKey: `ui-${createRandomUuid()}`,
      }),
    },
  );
  const payload: unknown = await response.json();
  const answered =
    typeof payload === "object" && payload !== null && "result" in payload
      ? payload.result
      : null;
  if (!response.ok || !isRecoveryResult(answered)) throw readFailure(payload);
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
  if (!response.ok || !isRecoveryView(recovery)) throw readFailure(payload);
  return recovery;
}

/**
 * Reads what can happen to an ended run and sends the executor's decision.
 *
 * @param runId - The newest run of the plan, or `null` when there is none to recover.
 * @param onStarted - Selects a run that a restart or resume started.
 *
 * @remarks
 * Each decision carries the revision the executor saw and a fresh key, so a
 * double click or a repeated request starts nothing twice. The view is read
 * again after every decision and after a reload, from the server's state.
 */
export function usePlanRecovery(
  runId: string | null,
  onStarted: (runId: string) => void,
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
  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    async function load(id: string): Promise<void> {
      try {
        const view = await loadView(id, controller.signal);
        setState((previous) => ({
          runId: id,
          view,
          error: previous.runId === id ? previous.error : null,
          cleanupFailure:
            previous.runId === id ? previous.cleanupFailure : null,
        }));
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
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
    }
    void load(runId);
    return () => controller.abort();
  }, [runId, generation]);
  const current = state.runId === runId ? state : null;
  async function submit(
    request: PlanRecoveryRequest,
  ): Promise<AgentPlanRecoveryResult | null> {
    const view = current?.view;
    if (!runId || !view || isPending) return null;
    setPending(true);
    setResult(null);
    setState({ runId, view, error: null, cleanupFailure: null });
    try {
      const answered = await sendDecision(runId, view.revision, request);
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
      setPending(false);
      setGeneration((value) => value + 1);
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
