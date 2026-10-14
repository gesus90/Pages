import type { Capability } from "./Authorization";

/** A ticket an agent plan session may read and change. */
export interface AgentRunTicket {
  readonly id: string;
  readonly key: string;
}

/**
 * How far the credential of an agent plan session reaches.
 *
 * @remarks
 * `tickets` allows the listed operations on the bound tickets only. `read`
 * allows every reading operation and `full` every operation of the executor;
 * both still pass the normal checks of the executor's current rights.
 */
export const AGENT_RUN_REACHES = ["tickets", "read", "full"] as const;
export type AgentRunReach = (typeof AGENT_RUN_REACHES)[number];

/**
 * What the credential of one agent plan session allows, on top of the
 * current rights of its executor.
 */
export interface AgentRunScope {
  readonly runId: string;
  readonly stepId: string;
  /**
   * Agent API operations the session may call with the `tickets` reach; every
   * other one is refused. The other reaches derive theirs from the executor.
   */
  readonly operations: readonly string[];
  /** The tickets bound to the node; with the `tickets` reach every other ticket is refused. */
  readonly tickets: readonly AgentRunTicket[];
  readonly reach: AgentRunReach;
}

/** Current account rights verified by Pages, independent of the browser role mode. */
export interface AgentIdentity {
  readonly userId: string;
  readonly isAdmin: boolean;
  readonly permissions: readonly Capability[];
  /** Present for the credential of an agent plan session, which narrows the rights. */
  readonly run?: AgentRunScope;
}

/** Public personal-token summary; neither a credential nor its hash is included. */
export interface PersonalAgentToken {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly createdAt: number;
  readonly expiresAt: number | null;
  readonly revokedAt: number | null;
  readonly source: "manual" | "pairing";
  readonly device: string | null;
  readonly lastUsedAt: number | null;
  readonly rotatedAt: number | null;
  readonly rotationRequestedAt: number | null;
  readonly status: "active" | "expired" | "revoked";
}
