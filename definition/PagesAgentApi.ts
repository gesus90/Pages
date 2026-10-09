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
export type PagesAgentApiBusinessOperation = "projects.names.list";

/** Result of `verify`: the current identity and the business operations it may call. */
export interface PagesAgentApiVerification {
  readonly apiVersion: "1";
  readonly identity: PagesAgentApiIdentity;
  readonly tools: readonly PagesAgentApiBusinessOperation[];
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
  | "FORBIDDEN"
  | "METHOD_NOT_ALLOWED";

/** Public error envelope without credentials or underlying diagnostic messages. */
export interface PagesAgentApiFailure {
  readonly apiVersion: "1";
  readonly error: {
    readonly code: PagesAgentApiErrorCode;
    readonly message: string;
    readonly retryable: false;
  };
}
