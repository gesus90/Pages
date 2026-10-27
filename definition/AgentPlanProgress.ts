import type { AgentPlanWorkView } from "./AgentPlanWork";

/** Read-only checklist projection; it never changes execution or acceptance. */
export interface AgentPlanProgress {
  /** Saved relevant scope and checks of an explicitly gated node. */
  readonly work?: readonly AgentPlanWorkView[];
  readonly source: "live" | "historical";
  readonly observedAt: string;
  /** An unavailable read must never look like a confirmed empty checklist. */
  readonly availability?: "observed" | "unavailable";
  /** The execution attempt this observation belongs to, independent of host paths. */
  readonly scope?: {
    readonly runId: string;
    readonly stepId: string;
    readonly attemptId: string | null;
  };
  readonly tickets?: readonly {
    readonly id: string;
    readonly key: string;
    /** Hash of the observed checklist content, not a manufactured revision number. */
    readonly contentHash: string;
  }[];
  readonly todos: readonly AgentPlanProgressItem[];
}

/** Stable ticket identity, or the contract ID for an unbound requirement. */
export interface AgentPlanProgressItem {
  readonly id: string;
  readonly text: string;
  readonly status: "done" | "active" | "open" | "missing" | "unreported";
  readonly ticket?: {
    readonly id: string;
    readonly key: string;
    readonly itemId: string;
  };
}

/** Explicit public plan activities, scoped to the observer of the current ACP turn. */
export interface AgentPlanActivity {
  readonly reportedAt: string;
  /** Empty when the latest plan update reports no activity in progress. */
  readonly titles: readonly string[];
}
