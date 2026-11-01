import { sign } from "node:crypto";

import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { FcmLogThrottle } from "@/backend/service/mobile/notifications/FcmLogThrottle";
import {
  FCM_SCOPE,
  FCM_TOKEN_ENDPOINT,
} from "@/backend/service/mobile/notifications/FcmServiceAccount";

import type { FcmServiceAccount } from "@/backend/service/mobile/notifications/FcmServiceAccount";

const COMPONENT = "FcmAccessTokenProvider";
const REQUEST_TIMEOUT_MS = 10_000;
const ASSERTION_LIFETIME_SECONDS = 3_600;
const MINIMUM_LIFETIME_SECONDS = 60;
const MAXIMUM_LIFETIME_SECONDS = 3_600;
const REFRESH_MARGIN_MS = 300_000;
const MAXIMUM_TOKEN_LENGTH = 4_096;
const TOKEN_PATTERN = /^[A-Za-z0-9\-._~+/]+=*$/u;
const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const FAILURE_LOG_KEY = "token_request_failed";

/** The part of `fetch` the Firebase senders use, so tests can stand in for Google. */
export type FcmFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Replaceable parts of the access token provider. */
export interface FcmAccessTokenOptions {
  /** HTTP function; defaults to the global `fetch`. */
  readonly fetch?: FcmFetch;
  /** Clock in milliseconds; defaults to `Date.now`. */
  readonly now?: () => number;
}

interface CachedToken {
  readonly value: string;
  readonly refreshAtMs: number;
}

interface TokenResponse {
  readonly accessToken: string;
  readonly lifetimeSeconds: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeSegment(segment: object): string {
  return Buffer.from(JSON.stringify(segment)).toString("base64url");
}

function buildAssertion(
  account: FcmServiceAccount,
  issuedAtSeconds: number,
): string {
  const header = encodeSegment({ alg: "RS256", typ: "JWT" });
  const claims = encodeSegment({
    aud: FCM_TOKEN_ENDPOINT,
    exp: issuedAtSeconds + ASSERTION_LIFETIME_SECONDS,
    iat: issuedAtSeconds,
    iss: account.clientEmail,
    scope: FCM_SCOPE,
  });
  const signingInput = `${header}.${claims}`;
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(signingInput),
    account.privateKey,
  ).toString("base64url");

  return `${signingInput}.${signature}`;
}

function buildRequestBody(assertion: string): string {
  return new URLSearchParams({
    assertion,
    grant_type: JWT_BEARER_GRANT,
  }).toString();
}

function parseTokenResponse(body: unknown): TokenResponse | null {
  if (!isRecord(body)) {
    return null;
  }

  const accessToken = body["access_token"];
  const expiresIn = body["expires_in"];

  if (
    typeof accessToken !== "string" ||
    accessToken.length > MAXIMUM_TOKEN_LENGTH ||
    // The token becomes a header value; anything but plain token characters is refused.
    !TOKEN_PATTERN.test(accessToken) ||
    typeof expiresIn !== "number" ||
    !Number.isFinite(expiresIn)
  ) {
    return null;
  }

  return {
    accessToken,
    lifetimeSeconds: Math.min(
      Math.max(expiresIn, MINIMUM_LIFETIME_SECONDS),
      MAXIMUM_LIFETIME_SECONDS,
    ),
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    // The error message of a failed parse can quote the body; only the fact is kept.
    return null;
  }
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch (caughtError: unknown) {
    logCaughtError(COMPONENT, caughtError);
  }
}

/**
 * Obtains and caches the OAuth2 access token that authorizes FCM HTTP v1 calls.
 *
 * @remarks
 * Signs a JWT assertion with the service-account key (RS256) and exchanges it
 * at the fixed Google token endpoint, using only `fetch` and `node:crypto`.
 * The token is cached until five minutes before it expires, and concurrent
 * callers share one refresh. It is deliberately not added to the process-wide
 * list of redacted secrets, which is small and never evicts; nothing here logs it. The key, the assertion and the token never reach a
 * log or a return value other than the token itself; a failure is logged as a
 * status code, at most once per minute.
 */
export class FcmAccessTokenProvider {
  private readonly account: FcmServiceAccount;
  private readonly sendRequest: FcmFetch;
  private readonly now: () => number;
  private readonly logThrottle: FcmLogThrottle;
  private cached: CachedToken | null = null;
  private pending: Promise<string | null> | null = null;

  /**
   * Creates a provider for one service account.
   *
   * @param account - The validated service-account key.
   * @param options - HTTP function and clock; both default to the real ones.
   */
  public constructor(
    account: FcmServiceAccount,
    options: FcmAccessTokenOptions = {},
  ) {
    this.account = account;
    this.sendRequest = options.fetch ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? ((): number => Date.now());
    this.logThrottle = new FcmLogThrottle(this.now);
  }

  /**
   * Returns a valid access token, refreshing it when it is close to expiry.
   *
   * @returns The token, or `null` when Google did not issue one. It never throws.
   */
  public async read(): Promise<string | null> {
    const cached = this.cached;

    if (cached !== null && this.now() < cached.refreshAtMs) {
      return cached.value;
    }

    this.pending ??= this.refresh();

    return this.pending;
  }

  /**
   * Drops the cached token, so the next read asks Google for a new one.
   *
   * @remarks
   * Call it after FCM answered `401`. A refresh that is already running is kept:
   * it was started for the same reason and its result is newer than the token
   * that failed.
   */
  public invalidate(): void {
    this.cached = null;
  }

  private async refresh(): Promise<string | null> {
    try {
      return await this.requestToken();
    } finally {
      this.pending = null;
    }
  }

  private async requestToken(): Promise<string | null> {
    const startedAtMs = this.now();

    try {
      const assertion = buildAssertion(
        this.account,
        Math.floor(startedAtMs / 1000),
      );
      // A redirect would resend the signed assertion to another host.
      const response = await this.sendRequest(FCM_TOKEN_ENDPOINT, {
        body: buildRequestBody(assertion),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      return await this.acceptResponse(response, startedAtMs);
    } catch (caughtError: unknown) {
      logCaughtError(COMPONENT, caughtError);
      this.warnFailure(null);

      return null;
    }
  }

  private async acceptResponse(
    response: Response,
    startedAtMs: number,
  ): Promise<string | null> {
    if (!response.ok) {
      await discardBody(response);
      this.warnFailure(response.status);

      return null;
    }

    const token = parseTokenResponse(await readJson(response));

    if (token === null) {
      this.warnFailure(response.status);

      return null;
    }

    const lifetimeMs = token.lifetimeSeconds * 1000;
    // Never keep a short-lived token for less than half of its life.
    const marginMs = Math.min(REFRESH_MARGIN_MS, lifetimeMs / 2);

    this.cached = {
      refreshAtMs: startedAtMs + lifetimeMs - marginMs,
      value: token.accessToken,
    };

    return token.accessToken;
  }

  private warnFailure(statusCode: number | null): void {
    if (!this.logThrottle.allow(FAILURE_LOG_KEY)) {
      return;
    }

    logEvent({
      component: COMPONENT,
      event: "integration.fcm.token_request_failed",
      level: "warn",
      message: "FCM access token request failed",
      metadata:
        statusCode === null
          ? { reason: FAILURE_LOG_KEY }
          : { reason: FAILURE_LOG_KEY, statusCode },
    });
  }
}
