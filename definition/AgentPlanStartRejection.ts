import type { AgentPlanWorkspaceConflict } from "./AgentPlanWorkspaceConflict.js";
import type { AgentPlanIssueEntry } from "./AgentPlanOperations.js";

/** A past start refusal before a run was created; it is not the current control state. */
export interface AgentPlanStartRejection {
  readonly id: string;
  readonly createdAt: string;
  readonly action: "play" | "save_and_play";
  /** The attempted revision, which is not yet saved for a failed save-and-play. */
  readonly planRevision: number;
  readonly isSavedRevision: boolean;
  /** A stable Pages error code, validated when the record is stored and read. */
  readonly error: string;
  /** Bounded graph findings omit asset identities and other private contents. */
  readonly issues?: readonly Omit<AgentPlanIssueEntry, "asset">[];
  /** Some findings or resource details were omitted from the historical entry. */
  readonly issueDetailsFiltered?: boolean;
  /** No foreign owner, run or attempt is included. */
  readonly conflict: AgentPlanWorkspaceConflict | null;
  readonly reservation: "not_requested" | "held" | "unknown";
  /** Remote registered paths are not claimed to be canonical without runner proof. */
  readonly targetResolution:
    "local_resolved" | "remote_registered" | "mixed" | "unknown";
}
/** One append-only history entry; the cursor selects strictly older own entries. */
export interface AgentPlanStartRejectionPage {
  readonly entry: AgentPlanStartRejection | null;
  readonly nextBefore: string | null;
}
