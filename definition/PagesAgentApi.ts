/** JSON operation envelope reserved for the version 1 Pages agent API. */
export interface PagesAgentApiRequest {
  readonly operation: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

/** Stable failures available before agent authentication is implemented. */
export type PagesAgentApiErrorCode =
  "AUTH_REQUIRED" | "AUTH_NOT_READY" | "METHOD_NOT_ALLOWED";

/** Public, unprivileged error envelope; no successful operation exists yet. */
export interface PagesAgentApiFailure {
  readonly apiVersion: "1";
  readonly error: {
    readonly code: PagesAgentApiErrorCode;
    readonly message: string;
    readonly retryable: false;
  };
}
