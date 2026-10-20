import type { PersonalAgentToken } from "./McpAuthorization";

/** Public personal connections data; no token or hash is returned to a browser. */
export interface McpConnectionsView {
  readonly origin: string;
  readonly httpEndpoint?: string;
  readonly packageVersion: string;
  readonly validityDays: number;
  readonly tokens: readonly PersonalAgentToken[];
}
