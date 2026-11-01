import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { FcmAccessTokenProvider } from "@/backend/service/mobile/notifications/FcmAccessToken";
import { FcmLogThrottle } from "@/backend/service/mobile/notifications/FcmLogThrottle";
import { readFcmServiceAccount } from "@/backend/service/mobile/notifications/FcmServiceAccount";

import type { FcmFetch } from "@/backend/service/mobile/notifications/FcmAccessToken";
import type { FcmServiceAccount } from "@/backend/service/mobile/notifications/FcmServiceAccount";
import type {
  PicaMobilePushMessage,
  PicaMobilePushOutcome,
  PicaMobilePushSender,
} from "@/backend/service/mobile/notifications/PicaMobilePushSender";

const COMPONENT = "FcmPicaMobilePushSender";
const PROJECTS_URL = "https://fcm.googleapis.com/v1/projects/";
const REQUEST_TIMEOUT_MS = 10_000;
const MAXIMUM_REQUEST_BYTES = 4_000;
const MAXIMUM_ERROR_BODY_CHARS = 8_192;
const MAXIMUM_RETRY_AFTER_SECONDS = 3_600;
// FCM holds a message for four weeks at most.
const MAXIMUM_TTL_SECONDS = 2_419_200;
const ERROR_CODE_PATTERN = /^[A-Z_]{3,40}$/u;
const FCM_ERROR_TYPE_SUFFIX = "google.firebase.fcm.v1.FcmError";
const BAD_REQUEST_TYPE_SUFFIX = "google.rpc.BadRequest";
const TOKEN_FIELD = "message.token";

/** Replaceable parts of the FCM sender. */
export interface FcmPicaMobilePushSenderOptions {
  /** HTTP function; defaults to the global `fetch`. */
  readonly fetch?: FcmFetch;
  /** Clock in milliseconds; defaults to `Date.now`. */
  readonly now?: () => number;
  /** Source of the OAuth access token; defaults to a provider for the account. */
  readonly tokens?: Pick<FcmAccessTokenProvider, "read" | "invalidate">;
}

type LocalProblem = "payload_invalid" | "payload_too_large" | "request_failed";

type RequestBody =
  | { readonly json: string }
  | { readonly problem: "payload_invalid" | "payload_too_large" };

/** What FCM said about a failure, reduced to the codes Pages acts on. */
interface FcmErrorFacts {
  /** The Google RPC status, for example `NOT_FOUND`. */
  readonly status: string | null;
  /** The FCM specific `errorCode`, for example `UNREGISTERED`. */
  readonly errorCode: string | null;
  /** Whether a field violation names `message.token`. */
  readonly isTokenInvalid: boolean;
}

interface FcmReply {
  readonly statusCode: number;
  readonly retryAfter: string | null;
  readonly facts: FcmErrorFacts;
}

const NO_ERROR_FACTS: FcmErrorFacts = {
  errorCode: null,
  isTokenInvalid: false,
  status: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildRequestBody(message: PicaMobilePushMessage): RequestBody {
  const isValid =
    message.token.length > 0 &&
    Number.isInteger(message.ttlSeconds) &&
    message.ttlSeconds >= 1 &&
    Object.values(message.data).every(
      (entry: unknown) => typeof entry === "string",
    );

  if (!isValid) {
    return { problem: "payload_invalid" };
  }

  // Nothing else is set: no collapse key, sound, icon, image or platform override.
  const json = JSON.stringify({
    message: {
      token: message.token,
      data: message.data,
      notification: { title: message.title, body: message.body },
      android: {
        priority: "HIGH",
        ttl: `${Math.min(message.ttlSeconds, MAXIMUM_TTL_SECONDS)}s`,
        notification: {
          channel_id: message.channelId,
          tag: message.tag,
          visibility: "PRIVATE",
        },
      },
    },
  });

  return Buffer.byteLength(json) > MAXIMUM_REQUEST_BYTES
    ? { problem: "payload_too_large" }
    : { json };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // The error message of a failed parse can quote the body; only the fact is kept.
    return null;
  }
}

function readErrorCode(candidate: unknown): string | null {
  return typeof candidate === "string" && ERROR_CODE_PATTERN.test(candidate)
    ? candidate
    : null;
}

function hasTypeSuffix(detail: Record<string, unknown>, suffix: string): boolean {
  const type = detail["@type"];

  return typeof type === "string" && type.endsWith(suffix);
}

function readFcmErrorCode(details: readonly unknown[]): string | null {
  for (const detail of details) {
    if (isRecord(detail) && hasTypeSuffix(detail, FCM_ERROR_TYPE_SUFFIX)) {
      return readErrorCode(detail["errorCode"]);
    }
  }

  return null;
}

function isTokenViolation(violation: unknown): boolean {
  if (!isRecord(violation)) {
    return false;
  }

  const field = violation["field"];

  return typeof field === "string" && field.startsWith(TOKEN_FIELD);
}

function isTokenBadRequest(detail: unknown): boolean {
  if (!isRecord(detail) || !hasTypeSuffix(detail, BAD_REQUEST_TYPE_SUFFIX)) {
    return false;
  }

  const violations = detail["fieldViolations"];

  return Array.isArray(violations) && violations.some(isTokenViolation);
}

function parseErrorFacts(text: string): FcmErrorFacts {
  const body = parseJson(text);
  const error = isRecord(body) ? body["error"] : null;

  if (!isRecord(error)) {
    return NO_ERROR_FACTS;
  }

  const details: readonly unknown[] = Array.isArray(error["details"])
    ? error["details"]
    : [];

  return {
    errorCode: readFcmErrorCode(details),
    isTokenInvalid: details.some(isTokenBadRequest),
    status: readErrorCode(error["status"]),
  };
}

// The body is only read for its error codes; a body that cannot be read leaves
// the status code as the only fact, which is also right for a `200`.
async function readErrorFacts(response: Response): Promise<FcmErrorFacts> {
  try {
    const text = await response.text();

    return parseErrorFacts(text.slice(0, MAXIMUM_ERROR_BODY_CHARS));
  } catch (caughtError: unknown) {
    logCaughtError(COMPONENT, caughtError);

    return NO_ERROR_FACTS;
  }
}

function parseRetryAfter(header: string | null, nowMs: number): number | null {
  const text = header?.trim() ?? "";
  const seconds = /^\d{1,9}$/u.test(text)
    ? Number(text)
    : Math.ceil((Date.parse(text) - nowMs) / 1000);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return Math.min(seconds, MAXIMUM_RETRY_AFTER_SECONDS);
}

function buildRetry(header: string | null, nowMs: number): PicaMobilePushOutcome {
  const retryAfterSeconds = parseRetryAfter(header, nowMs);

  return retryAfterSeconds === null
    ? { kind: "retry" }
    : { kind: "retry", retryAfterSeconds };
}

// Only the token itself may be called invalid: `UNREGISTERED`, or a `400` that
// names `message.token`. A plain `404`, a `400` without that field violation,
// `SENDER_ID_MISMATCH` and `403` can describe the payload or the project (a
// project that is missing or has the API switched off also answers `404`), and
// acting on them would wipe registrations that are fine.
function classifyReply(reply: FcmReply, nowMs: number): PicaMobilePushOutcome {
  const { facts, statusCode } = reply;

  if (statusCode === 200) {
    return { kind: "sent" };
  }

  if (statusCode === 401) {
    return { kind: "unavailable" };
  }

  if (statusCode === 403) {
    return facts.errorCode === "SENDER_ID_MISMATCH"
      ? { kind: "rejected" }
      : { kind: "unavailable" };
  }

  if (facts.errorCode === "UNREGISTERED") {
    return { kind: "invalidToken" };
  }

  if (statusCode === 400) {
    return facts.isTokenInvalid
      ? { kind: "invalidToken" }
      : { kind: "rejected" };
  }

  if (statusCode === 429 || statusCode >= 500) {
    return buildRetry(reply.retryAfter, nowMs);
  }

  return { kind: "rejected" };
}

/**
 * Delivers Pica Mobile push messages to Android devices through FCM HTTP v1.
 *
 * @remarks
 * Uses only `fetch` and `node:crypto`; the access token comes from the
 * service-account key. A message goes out as one `high` priority request with
 * a visible, private notification and the data map unchanged. The token of the
 * device, the access token, the message text and every response body stay out
 * of the log: a failure is logged as a status code and the FCM error code, at
 * most once per minute for the same pair.
 */
export class FcmPicaMobilePushSender implements PicaMobilePushSender {
  private readonly endpoint: string;
  private readonly sendRequest: FcmFetch;
  private readonly now: () => number;
  private readonly tokens: Pick<FcmAccessTokenProvider, "read" | "invalidate">;
  private readonly logThrottle: FcmLogThrottle;

  /**
   * Creates a sender for one Firebase project.
   *
   * @param account - The validated service-account key; it names the project.
   * @param options - HTTP function, clock and token source, for tests.
   */
  public constructor(
    account: FcmServiceAccount,
    options: FcmPicaMobilePushSenderOptions = {},
  ) {
    this.endpoint = `${PROJECTS_URL}${encodeURIComponent(account.projectId)}/messages:send`;
    this.sendRequest = options.fetch ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? ((): number => Date.now());
    this.tokens =
      options.tokens ??
      new FcmAccessTokenProvider(account, {
        fetch: this.sendRequest,
        now: this.now,
      });
    this.logThrottle = new FcmLogThrottle(this.now);
  }

  /**
   * Gets the sender ready: fetches the access token when it has none.
   *
   * @returns `false` when Google issued no token, so a send would fail anyway.
   */
  public async ready(): Promise<boolean> {
    return (await this.tokens.read()) !== null;
  }

  /**
   * Sends one message to one device.
   *
   * @remarks
   * A request over 4000 bytes or with a non-text data value is rejected without
   * a network call. A `401` drops the access token and repeats the request once
   * with a fresh one. `INVALID_ARGUMENT` is an invalid token only when FCM names
   * `message.token` as the field; a `404` is one only with `UNREGISTERED`;
   * `SENDER_ID_MISMATCH` and `403` never are.
   *
   * @param message - What to deliver and to whom.
   * @returns The outcome; it never rejects. A network error or a timeout is
   * `retry`; without an access token the outcome is `unavailable`.
   */
  public async send(
    message: PicaMobilePushMessage,
  ): Promise<PicaMobilePushOutcome> {
    try {
      return await this.deliver(message);
    } catch (caughtError: unknown) {
      logCaughtError(COMPONENT, caughtError);
      this.logLocalProblem("request_failed");

      return { kind: "retry" };
    }
  }

  private async deliver(
    message: PicaMobilePushMessage,
  ): Promise<PicaMobilePushOutcome> {
    const request = buildRequestBody(message);

    if ("problem" in request) {
      this.logLocalProblem(request.problem);

      return { kind: "rejected" };
    }

    const reply = await this.postWithFreshToken(request.json);

    if (reply === null) {
      return { kind: "unavailable" };
    }

    const outcome = classifyReply(reply, this.now());

    this.logReply(reply, outcome);

    return outcome;
  }

  private async postWithFreshToken(json: string): Promise<FcmReply | null> {
    const accessToken = await this.tokens.read();

    if (accessToken === null) {
      return null;
    }

    const reply = await this.post(json, accessToken);

    if (reply.statusCode !== 401) {
      return reply;
    }

    this.tokens.invalidate();

    const freshToken = await this.tokens.read();

    return freshToken === null ? null : this.post(json, freshToken);
  }

  private async post(json: string, accessToken: string): Promise<FcmReply> {
    // A redirect must never carry the access token or the message elsewhere.
    const response = await this.sendRequest(this.endpoint, {
      body: json,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    return {
      facts: await readErrorFacts(response),
      retryAfter: response.headers.get("retry-after"),
      statusCode: response.status,
    };
  }

  private logReply(reply: FcmReply, outcome: PicaMobilePushOutcome): void {
    if (outcome.kind === "sent") {
      return;
    }

    const code = reply.facts.errorCode ?? reply.facts.status;

    if (!this.logThrottle.allow(`${reply.statusCode}:${code ?? ""}:${outcome.kind}`)) {
      return;
    }

    logEvent({
      component: COMPONENT,
      event: "integration.fcm.send_failed",
      level: "warn",
      message: "FCM did not accept a push message",
      metadata: {
        code,
        reason: outcome.kind,
        statusCode: reply.statusCode,
      },
    });
  }

  private logLocalProblem(problem: LocalProblem): void {
    if (!this.logThrottle.allow(problem)) {
      return;
    }

    logEvent({
      component: COMPONENT,
      event: "integration.fcm.send_failed",
      level: "warn",
      message: "A push message could not be sent to FCM",
      metadata: { reason: problem },
    });
  }
}

/**
 * Creates the FCM sender from a service-account key file.
 *
 * @param filePath - Path of the Google service-account JSON key file.
 * @returns The sender, or `null` when the file does not hold a usable key; the
 * reason is logged by {@link readFcmServiceAccount}.
 */
export function createFcmPicaMobilePushSender(
  filePath: string,
): FcmPicaMobilePushSender | null {
  const account = readFcmServiceAccount(filePath);

  return account === null ? null : new FcmPicaMobilePushSender(account);
}
