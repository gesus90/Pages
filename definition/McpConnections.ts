import type { PersonalAgentToken } from "./McpAuthorization";
import type { PicaMobileSettingsView } from "./PicaMobile";

/** Public personal connections data; no token or hash is returned to a browser. */
export interface McpConnectionsView {
  readonly origin: string;
  readonly httpEndpoint?: string;
  /** Only present for an administrator in the admin mode. */
  readonly picaMobile?: PicaMobileSettingsView;
  readonly packageVersion: string;
  readonly validityDays: number;
  readonly tokens: readonly PersonalAgentToken[];
}
