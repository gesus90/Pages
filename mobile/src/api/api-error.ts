/** Why a request to the Pages server failed, for the caller to react to. */
export type ApiErrorKind =
  "network" | "timeout" | "aborted" | "http" | "invalid-response";

/** Base class of every failure of the Pages API layer. */
export class PagesApiError extends Error {
  public readonly kind: ApiErrorKind;

  public constructor(kind: ApiErrorKind, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = new.target.name;
    this.kind = kind;
  }
}

/** The server could not be reached: no network, DNS, TLS or refused connection. */
export class NetworkError extends PagesApiError {
  public constructor(cause?: unknown) {
    super("network", "The Pages server could not be reached.", cause);
  }
}

/** The server did not answer within the time limit. */
export class RequestTimeoutError extends PagesApiError {
  public constructor(timeoutMilliseconds: number) {
    super(
      "timeout",
      `The Pages server did not answer within ${timeoutMilliseconds} ms.`,
    );
  }
}

/** The caller cancelled the request, for example because the address changed. */
export class RequestAbortedError extends PagesApiError {
  public constructor() {
    super("aborted", "The request was cancelled.");
  }
}

/** The server answered with a status that is not a success. */
export class HttpStatusError extends PagesApiError {
  public readonly status: number;

  /** The body the server sent with the error, when it was JSON. */
  public readonly body: unknown;

  public constructor(status: number, body: unknown) {
    super("http", `The Pages server answered with status ${status}.`);
    this.status = status;
    this.body = body;
  }

  /** Whether the server asks for credentials the app does not send (yet). */
  public get isUnauthorized(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** The answer of the server did not have the expected shape. */
export class InvalidResponseError extends PagesApiError {
  public constructor(message: string, cause?: unknown) {
    super("invalid-response", message, cause);
  }
}

/**
 * Narrows a caught value to a failure of the API layer.
 *
 * @param error - Anything that was thrown.
 * @returns Whether the value is a `PagesApiError`.
 */
export function isPagesApiError(error: unknown): error is PagesApiError {
  return error instanceof PagesApiError;
}
