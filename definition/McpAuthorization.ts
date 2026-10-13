import type { Capability } from "./Authorization";

/** A ticket an agent plan session may read and change. */
export interface AgentRunTicket {
  readonly id: string;
  readonly key: string;
}

/**
 * What the credential of one agent plan session allows, on top of the
 * current rights of its executor.
 */
export interface AgentRunScope {
  readonly runId: string;
  readonly stepId: string;
  /** Agent API operations the session may call; every other one is refused. */
  readonly operations: readonly string[];
  /** The tickets bound to the node; every other ticket is refused. */
  readonly tickets: readonly AgentRunTicket[];
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
