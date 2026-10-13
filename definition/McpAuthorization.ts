import type { Capability } from "./Authorization";

/** Current account rights verified by Pages, independent of the browser role mode. */
export interface AgentIdentity {
  readonly userId: string;
  readonly isAdmin: boolean;
  readonly permissions: readonly Capability[];
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
