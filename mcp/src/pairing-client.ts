import { instanceEndpoint } from "./instance-address.js";

import type { McpPairedCredential } from "../../definition/McpPairing.js";

/** Device-only request response; callers must never print its secret. */
export interface DevicePairingRequest {
  readonly userCode: string;
  readonly deviceSecret: string;
  readonly expiresAt: number;
  readonly interval: number;
}

/** Stable protocol or network failure with no server-supplied diagnostics. */
export class PairingClientError extends Error {
  public readonly code: string;
  public readonly retryAfter: number;

  public constructor(code: string, retryAfter = 0) {
    super("Pages pairing failed.");
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

/** Pages pairing adapter that neither follows redirects nor reflects bodies in errors. */
export class PairingClient {
  private readonly instance: URL;

  public constructor(instance: URL) {
    this.instance = instance;
  }

  /** Checks the instance branding before exposing any code to a user. */
  public async begin(
    input: { clientName: string; device: string; packageVersion: string },
    signal?: AbortSignal,
  ): Promise<DevicePairingRequest> {
    const result = await this.post("", input, signal);
    if (
      !isRecord(result) ||
      result.service !== "pages" ||
      result.apiVersion !== "1" ||
      typeof result.userCode !== "string" ||
      !/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/.test(
        result.userCode,
      ) ||
      typeof result.deviceSecret !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(result.deviceSecret) ||
      typeof result.expiresAt !== "number" ||
      !Number.isSafeInteger(result.expiresAt) ||
      result.interval !== 5
    )
      throw new PairingClientError("wrong_instance");
    return {
      userCode: result.userCode,
      deviceSecret: result.deviceSecret,
      expiresAt: result.expiresAt,
      interval: result.interval,
    };
  }

  /** Collects a credential once, after approval, and validates all stored fields. */
  public async exchange(
    request: DevicePairingRequest,
    signal?: AbortSignal,
  ): Promise<McpPairedCredential> {
    const result = await this.post(
      "/token",
      { userCode: request.userCode, deviceSecret: request.deviceSecret },
      signal,
    );
    if (
      !isRecord(result) ||
      typeof result.token !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(result.token) ||
      typeof result.tokenId !== "string" ||
      !result.tokenId ||
      typeof result.name !== "string" ||
      !result.name ||
      result.name.length > 100 ||
      (result.expiresAt !== null &&
        (typeof result.expiresAt !== "number" ||
          !Number.isSafeInteger(result.expiresAt))) ||
      !isRecord(result.account) ||
      typeof result.account.displayName !== "string" ||
      typeof result.account.username !== "string"
    )
      throw new PairingClientError("handoff_failed");
    return {
      token: result.token,
      tokenId: result.tokenId,
      name: result.name,
      expiresAt: result.expiresAt,
      account: {
        displayName: result.account.displayName,
        username: result.account.username,
      },
    };
  }

  /** Aborts an uncollected request; an already consumed request stays consumed. */
  public async cancel(request: DevicePairingRequest): Promise<void> {
    await this.post("/cancel", {
      userCode: request.userCode,
      deviceSecret: request.deviceSecret,
    });
  }

  private async post(
    suffix: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(
        instanceEndpoint(this.instance, `api/v1/pairing${suffix}`),
        {
          method: "POST",
          redirect: "error",
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
            : AbortSignal.timeout(5000),
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(input),
        },
      );
    } catch {
      throw new PairingClientError(signal?.aborted ? "cancelled" : "network");
    }
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new PairingClientError("wrong_instance");
    }
    if (!response.ok) {
      const error =
        isRecord(result) && typeof result.error === "string"
          ? result.error
          : "wrong_instance";
      const allowed = [
        "authorization_pending",
        "slow_down",
        "access_denied",
        "expired_token",
        "invalid_grant",
        "temporarily_unavailable",
      ];
      const retryAfter = Number(response.headers.get("Retry-After"));
      throw new PairingClientError(
        allowed.includes(error) ? error : "wrong_instance",
        Number.isFinite(retryAfter)
          ? Math.min(Math.max(retryAfter, 0), 3600)
          : 0,
      );
    }
    return result;
  }
}
