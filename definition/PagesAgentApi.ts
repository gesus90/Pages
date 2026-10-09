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
