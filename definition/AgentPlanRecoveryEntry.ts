import type {
  AgentPlanCleanupResource,
  AgentPlanCleanupFailureRecord,
} from "./AgentPlanCleanupResource.js";

/** Existing recovery availability, projected without checkpoints, prompts or provider-session identifiers. */
export interface AgentPlanRecoveryEntry {
  readonly planId: string;
  readonly runId: string;
  readonly revision: number;
  readonly planRevision: number;
  readonly currentPlanRevision: number;
  readonly state: string;
  /** A linked run ID is returned only when current access to that run is valid. */
  readonly continuedBy: string | null;
  readonly continuationStatus: "none" | "available" | "unavailable";
  readonly isCleanupUnconfirmed: boolean;
  readonly latestCleanupFailure?: AgentPlanCleanupFailureRecord | null;
  readonly cleanupResources: readonly (AgentPlanCleanupResource & {
    readonly stepName: string;
  })[];
  readonly restart: {
    readonly reviewStepIds?: readonly string[];
    readonly available: boolean;
    readonly reason: string | null;
  };
  readonly resume: {
    readonly available: boolean;
    readonly reason: string | null;
    readonly modes: readonly {
      readonly mode: string;
      readonly available: boolean;
    }[];
    readonly reusedStepIds: readonly string[];
    readonly reviewStepIds: readonly string[];
  };
  readonly release: {
    readonly available: boolean;
    readonly reason: string | null;
  };
  readonly blockers: readonly string[];
  /** The editor and personal MCP commands share the recovery decisions. */
  readonly commandSurface: "editor_and_mcp";
}
