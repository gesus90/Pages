import { useRef, useState } from "react";

import type {
  AgentPlanPhase,
  AgentPlanSources,
  AgentPlanTask,
} from "@/definition/AgentPlan";

/** Whether the tickets of the plan's project are being read again. */
export type PlanTicketStatus = "idle" | "loading" | "error";

/** Reads the tickets again, such as when the ticket choice opens. */
export interface PlanTicketRefresh {
  readonly status: PlanTicketStatus;
  readonly refresh: () => void;
}

interface FreshTickets {
  readonly tasks: readonly AgentPlanTask[];
  readonly phases: readonly AgentPlanPhase[];
}

interface RefreshState {
  readonly workspaceId: string;
  /** The sources the fresh tickets replace; newer sources win again. */
  readonly basis: AgentPlanSources | null;
  readonly status: PlanTicketStatus;
  readonly fresh: FreshTickets | null;
}

const IDLE: RefreshState = {
  workspaceId: "",
  basis: null,
  status: "idle",
  fresh: null,
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlanTask(value: unknown): value is AgentPlanTask {
  return (
    isRecord(value) &&
    ["id", "key", "title", "statusKey", "statusName", "createdAt", "updatedAt"]
      .map((field) => value[field])
      .every((field) => typeof field === "string") &&
    (value.type === "task" || value.type === "subtask") &&
    (value.parentId === null || typeof value.parentId === "string") &&
    typeof value.isDone === "boolean"
  );
}

function isPlanPhase(value: unknown): value is AgentPlanPhase {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    typeof value.name === "string" &&
    typeof value.isDone === "boolean"
  );
}

/** Reads tickets and workflow of the workspace's project with the server's visibility rules. */
async function loadPlanTickets(workspaceId: string): Promise<FreshTickets> {
  const response = await fetch(
    `/agent-api/plan-sources?workspaceId=${encodeURIComponent(workspaceId)}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("Plan tickets unavailable");
  const body: unknown = await response.json();
  const sources = isRecord(body) ? body.sources : null;
  if (
    !isRecord(body) ||
    body.workspaceId !== workspaceId ||
    !isRecord(sources) ||
    !Array.isArray(sources.tasks) ||
    !Array.isArray(sources.phases)
  )
    throw new Error("Plan tickets unreadable");
  const tasks: unknown[] = sources.tasks;
  const phases: unknown[] = sources.phases;
  return {
    tasks: tasks.filter(isPlanTask),
    phases: phases.filter(isPlanPhase),
  };
}

/**
 * Keeps the ticket list of the plan current while the editor stays open.
 *
 * @param workspaceId - The plan's workspace; its project owns the tickets.
 * @param basis - The sources the page or the workspace change loaded.
 * @returns The sources with the freshest tickets, and the refresh control.
 *
 * @remarks
 * Only the newest request may answer: a late answer of an earlier request,
 * or one for another workspace, is dropped. Tickets read once replace those
 * of `basis` until newer sources arrive, such as after saving.
 */
export function usePlanTicketRefresh(
  workspaceId: string,
  basis: AgentPlanSources,
): { readonly sources: AgentPlanSources; readonly tickets: PlanTicketRefresh } {
  const [state, setState] = useState<RefreshState>(IDLE);
  const request = useRef(0);
  const current =
    state.workspaceId === workspaceId && state.basis === basis ? state : IDLE;
  async function load(sequence: number): Promise<void> {
    try {
      const fresh = await loadPlanTickets(workspaceId);
      if (sequence === request.current)
        setState({ workspaceId, basis, status: "idle", fresh });
    } catch (error: unknown) {
      if (sequence !== request.current) return;
      console.warn("Plan tickets could not be refreshed", error);
      setState((previous) => ({ ...previous, status: "error" }));
    }
  }
  function refresh(): void {
    if (!workspaceId) return;
    request.current += 1;
    setState({ ...current, workspaceId, basis, status: "loading" });
    void load(request.current);
  }
  return {
    sources: current.fresh
      ? { ...basis, tasks: current.fresh.tasks, phases: current.fresh.phases }
      : basis,
    tickets: { status: current.status, refresh },
  };
}
