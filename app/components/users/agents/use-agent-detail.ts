import { useEffect, useState } from "react";

import { backendRequestHeaders } from "@/app/lib/backend-request";

import type { AgentEmployeeDetailData } from "@/definition/AgentEmployeePage";

/** What the panel knows about the agent it edits. */
export interface AgentDetailState {
  readonly detail: AgentEmployeeDetailData | null;
  readonly isLoading: boolean;
  readonly hasFailed: boolean;
}

function isDetail(value: unknown): value is AgentEmployeeDetailData {
  return (
    typeof value === "object" &&
    value !== null &&
    "agent" in value &&
    "memoryDetails" in value &&
    "activity" in value
  );
}

/**
 * Reads the panel of one agent from its endpoint (PAGE-266) while the panel
 * is open; `reloadKey` reads it again, for example after a save.
 */
export function useAgentDetail(
  agentId: string | null,
  reloadKey: number,
): AgentDetailState {
  const [state, setState] = useState<AgentDetailState>({
    detail: null,
    isLoading: agentId !== null,
    hasFailed: false,
  });
  useEffect(() => {
    if (agentId === null) {
      setState({ detail: null, isLoading: false, hasFailed: false });
      return undefined;
    }
    const controller = new AbortController();
    setState((current) => ({ ...current, isLoading: true, hasFailed: false }));
    void fetch(`/users-api/agents/${encodeURIComponent(agentId)}`, {
      cache: "no-store",
      headers: backendRequestHeaders({ Accept: "application/json" }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload: unknown = response.ok ? await response.json() : null;
        setState({
          detail: isDetail(payload) ? payload : null,
          isLoading: false,
          hasFailed: !isDetail(payload),
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("[pages] The agent could not be read.", error);
        setState({ detail: null, isLoading: false, hasFailed: true });
      });
    return () => controller.abort();
  }, [agentId, reloadKey]);
  return state;
}
