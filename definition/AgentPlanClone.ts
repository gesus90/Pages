/** A repair made while copying a visible plan into the caller's own context. */
export interface AgentPlanCloneAdjustment {
  readonly code:
    | "workspace_replaced"
    | "name_suffixed"
    | "source_revision_updated"
    | "legacy_form_cleaned"
    | "reference_cleared";
  readonly nodeId?: string;
}

/** The committed copy and its source; also persisted for idempotent command replay. */
export interface AgentPlanCloneReceipt {
  readonly planId: string;
  readonly revision: number;
  readonly sourcePlanId: string;
  readonly sourceRevision: number;
  readonly workspaceId: string;
  readonly adjustments: readonly AgentPlanCloneAdjustment[];
}
