/** Read-only checklist projection; it never changes execution or acceptance. */
export interface AgentPlanProgress {
  readonly source: "live" | "historical";
  readonly observedAt: string;
  readonly todos: readonly AgentPlanProgressItem[];
}

/** Stable ticket identity, or the contract ID for an unbound requirement. */
export interface AgentPlanProgressItem {
  readonly id: string;
  readonly text: string;
  readonly status: "done" | "open" | "missing" | "unreported";
}

/** Explicit public plan activities, scoped to the observer of the current ACP turn. */
export interface AgentPlanActivity {
  readonly reportedAt: string;
  /** Empty when the latest plan update reports no activity in progress. */
  readonly titles: readonly string[];
}
