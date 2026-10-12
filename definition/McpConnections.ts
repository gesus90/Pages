import type { PersonalAgentToken } from "./McpAuthorization";

/** Public personal connections data; no token or hash is returned to a browser. */
export interface McpConnectionsView {
  readonly origin: string;
  readonly packageVersion: string;
  readonly validityDays: number;
  readonly tokens: readonly PersonalAgentToken[];
  readonly oauth: {
    readonly durationSeconds: number | null;
    readonly grants: readonly {
      readonly id: string;
      readonly clientName: string;
      readonly verifiedAt: number;
      readonly expiresAt: number | null;
      readonly status: string;
    }[];
  };
}
