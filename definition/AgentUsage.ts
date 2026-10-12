import type { AgentProfileTarget } from "./AgentProfile";

/** Names an agent that blocks deleting its connection, group or department. */
export interface AgentReference {
  readonly id: string;
  readonly name: string;
}

/** Current references prevent deletion without silently withdrawing grants. */
export type AgentUsage =
  | {
      readonly kind: "assignment" | "sharing";
      readonly target: AgentProfileTarget;
    }
  | { readonly kind: "global" }
  | { readonly kind: "project" | "legacy" | "plan"; readonly id: string }
  | ({ readonly kind: "agent" } & AgentReference);

/** A ticket that an execution plan step binds to the agent; it is listed, never edited, in the agent panel. */
export interface AgentTaskAssignment {
  readonly planId: string;
  readonly planName: string;
  readonly taskId: string;
  readonly key: string;
  readonly title: string;
}
