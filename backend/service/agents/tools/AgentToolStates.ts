import type { AgentToolId } from "@/definition/AgentTools";
import type { AgentToolHealth, AgentToolLocation } from "./AgentToolContracts";

/** The last known installation and health of one tool. */
export interface AgentToolState {
  readonly location: AgentToolLocation | null;
  readonly health: AgentToolHealth;
  readonly dependency: AgentToolId | null;
  readonly checkedAt: string | null;
}

/** The state of a tool nobody checked yet. */
export const UNCHECKED_TOOL_STATE: AgentToolState = {
  location: null,
  health: {
    status: "missing_dependency",
    diagnostic: "not_checked",
    version: null,
  },
  dependency: null,
  checkedAt: null,
};

/** Cached tool states, together with the time each tool was last found ready. */
export class AgentToolStates {
  private readonly states = new Map<AgentToolId, AgentToolState>();
  private readonly lastSuccess = new Map<AgentToolId, string>();

  /** The cached state, or `undefined` before the first check. */
  public get(id: AgentToolId): AgentToolState | undefined {
    return this.states.get(id);
  }

  /** Replaces the state; a ready result also becomes the last successful check. */
  public set(id: AgentToolId, state: AgentToolState): void {
    this.states.set(id, state);
    if (state.health.status === "ready" && state.checkedAt !== null)
      this.lastSuccess.set(id, state.checkedAt);
  }

  /** When the tool was last found ready, or `null` when it never was. */
  public lastSuccessfulCheck(id: AgentToolId): string | null {
    return this.lastSuccess.get(id) ?? null;
  }
}
