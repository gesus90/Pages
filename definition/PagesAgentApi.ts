import type { AgentExtensionReadOperation } from "./AgentExtensions.js";
import type { AgentAdminReadOperation } from "./AgentAdministration.js";
import type { AgentWorkspaceReadOperation } from "./AgentWorkspaceOperations.js";
import type { PageAgentReadOperation } from "./PageAgentOperations.js";
import type { McpCredentialDetails } from "./McpPairing.js";
import type { PagesAgentWriteOperation } from "./PagesAgentWrites.js";
import type {
  PagesAgentCommentOperation,
  PagesAgentReadOperation,
  PagesAgentStructuredReadOperation,
  PagesAgentTicketReadOperation,
  AgentOperationDetails,
} from "./PagesAgentOperations.js";

/** JSON operation envelope reserved for the version 1 Pages agent API. */
export interface PagesAgentApiRequest {
  readonly operation: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** Verified identity wire contract; permission names originate exclusively in Pages. */
export interface PagesAgentApiIdentity {
  readonly userId: string;
  readonly isAdmin: boolean;
  readonly permissions: readonly string[];
}

/** Business operations Pages may offer to a verified identity. */
export type PagesAgentApiBusinessOperation =
  | "projects.names.list"
  | AgentExtensionReadOperation
  | AgentAdminReadOperation
  | AgentWorkspaceReadOperation
  | PageAgentReadOperation
  | PagesAgentReadOperation
  | PagesAgentStructuredReadOperation
  | PagesAgentTicketReadOperation
  | PagesAgentCommentOperation
  | PagesAgentWriteOperation;

/** Result of `verify`: the current identity and the business operations it may call. */
export interface PagesAgentApiVerification {
  readonly apiVersion: "1";
  readonly identity: PagesAgentApiIdentity;
  readonly tools: readonly PagesAgentApiBusinessOperation[];
  readonly credential?: McpCredentialDetails | null;
}

/** Result of `projects.names.list`: names only, without identifiers or content. */
export interface PagesAgentApiProjectNames {
  readonly apiVersion: "1";
  readonly projectNames: readonly string[];
}

/** Stable failures from the versioned authentication boundary. */
export type PagesAgentApiErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "AUTH_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "CONFIRMATION_REQUIRED"
  | "FORBIDDEN"
  | "METHOD_NOT_ALLOWED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "AMBIGUOUS"
  | "PAYLOAD_TOO_LARGE";

/** Public error envelope without credentials or underlying diagnostic messages. */
export interface PagesAgentApiFailure {
  readonly apiVersion: "1";
  readonly error: {
    readonly code: PagesAgentApiErrorCode;
    readonly message: string;
    readonly retryable: false;
    readonly details?: AgentOperationDetails;
  };
}
