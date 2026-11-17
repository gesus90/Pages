import type {
  AgentPlanReadOperation,
  AgentPlanRecoveryCommandOperation,
  AgentPlanWriteOperation,
  AgentPlanCommandOperation,
} from "./AgentPlanOperations.js";

/**
 * Additive contract revision, independently observable from a client's MCP bundle version.
 * @remarks
 * Revision 20 adds the explicit, checked release of workspace reservations by
 * the holder plan's current owner, independently of the original executor.
 */
export const AGENT_PLAN_CONTRACT_VERSION = 20;

/** Implementation discovery never substitutes for current per-plan access and availability. */
export interface AgentPlanCapabilities {
  readonly contractVersion: number;
  readonly operations: readonly (
    | AgentPlanReadOperation
    | AgentPlanWriteOperation
    | AgentPlanCommandOperation
    | AgentPlanRecoveryCommandOperation
  )[];
  readonly cloneSharing: "create_default";
  readonly resume: "durable_pause_boundary";
  /** Human provenance supported by each transport of this implementation. */
  readonly deletionConfirmation: {
    readonly stdio: "client_form";
    readonly http: "unavailable";
    readonly pica: "target_bound_message";
    /** A paired Pages MCP machine asks back and confirms with `confirmed: true`. */
    readonly device: "confirmed_flag";
  };
}
