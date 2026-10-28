/** A target already visible to the editor; no other run or owner is disclosed. */
export interface AgentPlanConflictTarget {
  readonly kind: "local" | "remote";
  readonly workspaceId: string;
  readonly path: string;
  readonly connectionName: string | null;
  readonly workspaceName: string | null;
}

/** The affected nodes and targets of a current workspace start refusal. */
export interface AgentPlanWorkspaceConflict {
  readonly kind: "parallel_writers" | "reserved";
  readonly targets: readonly AgentPlanConflictTarget[];
  readonly nodes: readonly { readonly id: string; readonly name: string }[];
}
