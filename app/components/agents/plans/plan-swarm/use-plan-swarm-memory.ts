import { useEffect, useState } from "react";

import { planSwarmMemoryViewSchema } from "@/definition/AgentPlanSwarmMemory";

import { planSwarmMemoryAddress } from "./plan-swarm-memory-model";

import type { AgentPlanSwarmMemoryView } from "@/definition/AgentPlanSwarmMemory";

/** Where loading the memory of a swarm node stands. */
export type PlanSwarmMemoryState =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly memory: AgentPlanSwarmMemoryView };

async function loadMemory(
  address: string,
  signal: AbortSignal,
): Promise<AgentPlanSwarmMemoryView> {
  const response = await fetch(address, { cache: "no-store", signal });
  const payload: unknown = await response.json();
  const memory =
    typeof payload === "object" && payload !== null && "memory" in payload
      ? payload.memory
      : null;
  const parsed = planSwarmMemoryViewSchema.safeParse(memory);
  if (!response.ok || !parsed.success)
    throw new Error("swarm_memory_unavailable");
  return parsed.data;
}

/**
 * Loads the shared memory of a swarm node while one of its tabs is open.
 * @param request - The run and node, the newest revision the run view knows and
 * whether a memory tab is open.
 * @returns The state and a retry after a failure.
 * @remarks
 * A new revision in the run view loads the memory again; the entries shown
 * so far stay visible meanwhile, so the tab does not flicker.
 */
export function usePlanSwarmMemory(request: {
  readonly runId: string;
  readonly stepId: string;
  readonly revision: number;
  readonly isOpen: boolean;
}): { readonly state: PlanSwarmMemoryState; readonly retry: () => void } {
  const [state, setState] = useState<PlanSwarmMemoryState>({
    status: "loading",
  });
  const [attempt, setAttempt] = useState(0);
  const { runId, stepId, revision, isOpen } = request;
  useEffect(() => {
    if (!isOpen) return undefined;
    const controller = new AbortController();
    void loadMemory(
      planSwarmMemoryAddress(runId, stepId),
      controller.signal,
    ).then(
      (memory) => setState({ status: "ready", memory }),
      () => {
        if (!controller.signal.aborted) setState({ status: "error" });
      },
    );
    return () => controller.abort();
  }, [runId, stepId, revision, isOpen, attempt]);
  function retry(): void {
    setState({ status: "loading" });
    setAttempt(attempt + 1);
  }
  return { state, retry };
}
