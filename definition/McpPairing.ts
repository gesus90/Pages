/** Browser session identity used only for approving a personal pairing request. */
export interface PairingBrowserIdentity {
  readonly userId: string;
  readonly session: string;
}

/** Browser-safe lifecycle of a device authorization request. */
export type McpPairingStatus =
  "pending" | "approved" | "denied" | "cancelled" | "consumed" | "expired";

/** Session-bound browser view; never includes the device secret or a token. */
export interface McpPairingView {
  readonly status: McpPairingStatus | "invalid" | "entry";
  readonly code: string;
  readonly csrf?: string;
  readonly clientName?: string;
  readonly device?: string;
  readonly packageVersion?: string;
  readonly requestedAt?: number;
  readonly expiresAt?: number;
  readonly validityDays?: number;
  readonly account: {
    readonly displayName: string;
    readonly username: string;
    readonly isAdmin: boolean;
  };
  readonly retryAfter?: number;
}

/** Device-only response issued once after explicit browser approval. */
export interface McpPairedCredential {
  readonly token: string;
  readonly tokenId: string;
  readonly name: string;
  readonly expiresAt: number | null;
  readonly account: {
    readonly displayName: string;
    readonly username: string;
  };
}

/** Public credential metadata supplied with a fresh verification. */
export interface McpCredentialDetails {
  readonly id: string;
  readonly name: string;
  readonly expiresAt: number | null;
  readonly rotationRequested: boolean;
}
