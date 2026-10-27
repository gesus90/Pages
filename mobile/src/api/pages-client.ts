import {
  HttpStatusError,
  InvalidResponseError,
  isPagesApiError,
  NetworkError,
  RequestAbortedError,
  RequestTimeoutError,
} from "./api-error";
import { ANONYMOUS_AUTH } from "./auth";

import type { AuthProvider } from "./auth";

/** Time limit of one request; a mobile network may be slow but not endless. */
export const DEFAULT_TIMEOUT_MILLISECONDS = 10_000;

/** Settings of a client for one Pages server. */
export interface PagesClientOptions {
  /** Normalized address of the server, see `parseServerAddress`. */
  readonly baseUrl: string;
  readonly auth?: AuthProvider;
  readonly timeoutMilliseconds?: number;
  /** The transport; tests replace it, the app uses the global `fetch`. */
  readonly fetchImplementation?: typeof fetch;
}

/** What differs between the requests of one client. */
export interface RequestOptions {
  /** Cancels the request, for example when the person changes the address. */
  readonly signal?: AbortSignal;
}

/** Turns an untrusted JSON value into the type the caller expects. */
export type ResponseParser<T> = (value: unknown) => T;

/** What the body of an answer held. */
type Body =
  | { readonly isJson: true; readonly value: unknown }
  | { readonly isJson: false };

/** What came back: the status and the body, both read within the time limit. */
interface Answer {
  readonly status: number;
  readonly isOk: boolean;
  readonly body: Body;
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), {
      once: true,
    });
  });
}

// A server that sends the headers and then stalls must not hold the request
// open, so the read of the body ends with the same abort signal.
async function readBody(
  response: Response,
  signal: AbortSignal,
): Promise<Body> {
  try {
    const value = await Promise.race<unknown>([
      response.json(),
      rejectOnAbort(signal),
    ]);

    return { isJson: true, value };
  } catch (error: unknown) {
    if (signal.aborted) {
      throw error;
    }

    return { isJson: false };
  }
}

/**
 * Typed HTTP access to one Pages server: the one place that builds requests,
 * adds credentials, applies the time limit and maps every failure to a
 * `PagesApiError`.
 */
export class PagesClient {
  private readonly baseUrl: string;
  private readonly auth: AuthProvider;
  private readonly timeoutMilliseconds: number;
  private readonly fetchImplementation: typeof fetch;

  public constructor(options: PagesClientOptions) {
    this.baseUrl = options.baseUrl;
    this.auth = options.auth ?? ANONYMOUS_AUTH;
    this.timeoutMilliseconds =
      options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
    this.fetchImplementation =
      options.fetchImplementation ?? ((...args) => fetch(...args));
  }

  /**
   * Reads JSON from the server.
   *
   * @param path - Path below the server address, starting with a slash.
   * @param parse - Validates the answer and returns it in its type.
   * @param options - Per-request settings.
   * @returns The parsed answer.
   * @throws {PagesApiError} For every failure: network, timeout, abort, a
   * status that is not a success, or an answer of the wrong shape.
   */
  public async getJson<T>(
    path: string,
    parse: ResponseParser<T>,
    options: RequestOptions = {},
  ): Promise<T> {
    const answer = await this.send(path, options);

    if (!answer.isOk) {
      // An error page without JSON still carries the status.
      throw new HttpStatusError(
        answer.status,
        answer.body.isJson ? answer.body.value : null,
      );
    }

    if (!answer.body.isJson) {
      throw new InvalidResponseError(
        "The Pages server did not answer with JSON.",
      );
    }

    try {
      return parse(answer.body.value);
    } catch (error: unknown) {
      if (isPagesApiError(error)) {
        throw error;
      }

      throw new InvalidResponseError(
        "The answer of the Pages server has an unexpected shape.",
        error,
      );
    }
  }

  private async send(path: string, options: RequestOptions): Promise<Answer> {
    if (options.signal?.aborted) {
      throw new RequestAbortedError();
    }

    const authorization = await this.auth.getAuthorizationHeader();

    // The caller may abort while the credentials resolve; the abort listener
    // below is registered later and would never hear that event.
    if (options.signal?.aborted) {
      throw new RequestAbortedError();
    }

    const headers: Record<string, string> = { Accept: "application/json" };

    if (authorization !== null) {
      headers.Authorization = authorization;
    }

    const controller = new AbortController();
    let hasTimedOut = false;
    const timer = setTimeout(() => {
      hasTimedOut = true;
      controller.abort();
    }, this.timeoutMilliseconds);
    const abortOnCallerSignal = (): void => controller.abort();

    options.signal?.addEventListener("abort", abortOnCallerSignal);

    try {
      const response = await this.fetchImplementation(
        `${this.baseUrl}${path}`,
        { headers, signal: controller.signal },
      );
      const body = await readBody(response, controller.signal);

      return { status: response.status, isOk: response.ok, body };
    } catch (error: unknown) {
      if (options.signal?.aborted) {
        throw new RequestAbortedError();
      }

      if (hasTimedOut) {
        throw new RequestTimeoutError(this.timeoutMilliseconds);
      }

      throw new NetworkError(error);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abortOnCallerSignal);
    }
  }
}
