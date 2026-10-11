import type { AgentProfileTarget } from "./AgentProfile";

/** Current references prevent deletion without silently withdrawing grants. */
export type AgentUsage =
  | {
      readonly kind: "assignment" | "sharing";
      readonly target: AgentProfileTarget;
    }
  | { readonly kind: "global" }
  | { readonly kind: "project" | "legacy" | "plan"; readonly id: string };
