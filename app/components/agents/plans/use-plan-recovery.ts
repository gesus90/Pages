import { useEffect, useState } from "react";

import { createRandomUuid } from "@/app/lib/random-uuid";

import type {
  AgentPlanRecoveryCommand,
  AgentPlanRecoveryResult,
  AgentPlanRecoveryView,
} from "@/definition/AgentPlanRecovery";

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

function readFailure(payload: unknown): string {
  return typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
    ? payload.error
    : "plan_connection_unavailable";
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
  if (!response.ok || !isRecoveryResult(answered))
    throw new Error(readFailure(payload));
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
    throw new Error(readFailure(payload));
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
  readonly isPending: boolean;
  readonly result: AgentPlanRecoveryResult | null;
  readonly submit: (request: PlanRecoveryRequest) => Promise<void>;
} {
  const [state, setState] = useState<RecoveryState>({
    runId: null,
    view: null,
    error: null,
  });
  const [isPending, setPending] = useState(false);
  const [result, setResult] = useState<AgentPlanRecoveryResult | null>(null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    async function load(id: string): Promise<void> {
      try {
        const view = await loadView(id, controller.signal);
        setState({ runId: id, view, error: null });
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        setState({
          runId: id,
          view: null,
          error:
            error instanceof Error
              ? error.message
              : "plan_connection_unavailable",
        });
      }
    }
    void load(runId);
    return () => controller.abort();
  }, [runId, generation]);
  const current = state.runId === runId ? state : null;
  async function submit(request: PlanRecoveryRequest): Promise<void> {
    const view = current?.view;
    if (!runId || !view || isPending) return;
    setPending(true);
    try {
      const answered = await sendDecision(runId, view.revision, request);
      setResult(answered);
      setState({ runId, view, error: null });
      if (answered.runId) onStarted(answered.runId);
    } catch (error: unknown) {
      setState({
        runId,
        view,
        error:
          error instanceof Error
            ? error.message
            : "plan_connection_unavailable",
      });
    } finally {
      setPending(false);
      setGeneration((value) => value + 1);
    }
  }
  return {
    view: current?.view ?? null,
    error: current?.error ?? null,
    isPending,
    result,
    submit,
  };
}
