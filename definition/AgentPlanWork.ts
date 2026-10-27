import type { AgentChecklistItem } from "./AgentTicketChecklist.js";

/** Version 1 opts standalone nodes in; diagnostic completion keeps its existing meaning. */
export interface AgentPlanCompletionGate {
  readonly version: 1;
  readonly requiredChecks: readonly string[];
}

/** A deliberate assignment of a real checklist entry to the current work. */
export interface AgentPlanWorkItem {
  readonly itemId: string;
  readonly relevant: boolean;
  /** Required for exclusions; preserved with every revision. */
  readonly reason: string;
}

/** Evidence of an actually executed required check, independent of the final JSON. */
export interface AgentPlanWorkCheck {
  readonly name: string;
  readonly command: string;
  readonly exitCode: number;
  readonly evidence: string;
}

/** One immutable, optimistic-concurrency protected scope or confirmation. */
export interface AgentPlanWorkRecord {
  readonly revision: number;
  readonly requirementsHash: string;
  readonly contentHash: string;
  /** Relevant checklist state; unrelated checkbox activity cannot invalidate this proof. */
  readonly scopeHash: string;
  readonly scope: readonly AgentPlanWorkItem[];
  readonly note: string;
  readonly proofs: readonly {
    readonly itemId: string;
    readonly evidence: string;
  }[];
  readonly checks: readonly AgentPlanWorkCheck[];
  readonly confirmed: boolean;
}

/** Public work metadata; it contains identifiers and evidence, never credentials or host paths. */
export interface AgentPlanWorkView {
  readonly runId: string;
  readonly stepId: string;
  readonly attemptId: string;
  readonly ticketId: string;
  readonly ticketKey: string;
  readonly statusKey: string;
  readonly requirementsHash: string;
  readonly contentHash: string;
  readonly requiredChecks: readonly string[];
  readonly items: readonly AgentChecklistItem[];
  readonly record: AgentPlanWorkRecord | null;
  readonly issues: readonly string[];
}
