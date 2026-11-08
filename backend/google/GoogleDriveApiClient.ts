import { GOOGLE_DRIVE_REQUESTED_SCOPES } from "@/backend/google/GoogleDriveConfig";
import {
  driveProblem,
  isRecord,
  readJson,
  readString,
  sendGoogleRequest,
} from "@/backend/google/GoogleDriveResponses";

import type { GoogleOAuthApplication } from "@/backend/google/GoogleDriveConfig";
import type { GoogleFetch } from "@/backend/google/GoogleDriveResponses";
import type { GoogleDriveProblem } from "@/definition/GoogleDrive";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ABOUT_URL =
  "https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress)";

/** The outcome of one call to Google: the value or the problem, never a thrown HTTP error. */
export type GoogleCallResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly problem: GoogleDriveProblem };

/** The tokens of a code exchange; both are secrets that stay on the server. */
export interface GoogleTokenGrant {
  readonly accessToken: string;
  /** Unix milliseconds after which the access token is no longer accepted. */
  readonly expiresAt: number;
  /** Google sends it only when it issues one; a renewal usually keeps the old one. */
  readonly refreshToken: string | null;
  readonly grantedScopes: readonly string[];
}

/** The Google account behind an access token, as Drive names it. */
export interface GoogleDriveAccount {
  /** Stable identifier of the account in Drive; the binding relies on it. */
  readonly permissionId: string;
  readonly emailAddress: string | null;
}

/**
 * Translates a refused token request.
 *
 * @remarks
 * `invalid_grant` means the refresh token or code is expired or revoked, which
 * only a new sign-in repairs. `invalid_client` and `unauthorized_client` mean
 * the OAuth client of the instance is wrong, which no sign-in repairs.
 */
function tokenProblem(status: number, body: unknown): GoogleDriveProblem {
  const error = isRecord(body) ? readString(body, "error") : "";

  if (error === "invalid_grant") {
    return "access_revoked";
  }

  if (error === "invalid_client" || error === "unauthorized_client") {
    return "client_invalid";
  }

  return status >= 500 || status === 429
    ? "google_unreachable"
    : "client_invalid";
}

function readGrant(body: unknown, now: number): GoogleTokenGrant | null {
  if (!isRecord(body)) {
    return null;
  }

  const accessToken = readString(body, "access_token");
  const expiresIn = Number(body["expires_in"]);

  if (accessToken === "" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return null;
  }

  const refreshToken = readString(body, "refresh_token");

  return {
    accessToken,
    expiresAt: now + expiresIn * 1000,
    grantedScopes: readString(body, "scope").split(" ").filter(Boolean),
    refreshToken: refreshToken === "" ? null : refreshToken,
  };
}

/**
 * Builds the official Google sign-in link for the Drive connection.
 *
 * @param input - Client id, the exact redirect URI, the OAuth state and the PKCE challenge.
 * @returns The authorization link.
 *
 * @remarks
 * `access_type=offline` asks for a refresh token, and `prompt=consent` makes
 * Google issue a new one on every sign-in, so a new sign-in after a revocation
 * really replaces the stored access.
 */
export function buildGoogleAuthorizationUrl(input: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
}): string {
  const url = new URL(AUTHORIZE_URL);

  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_DRIVE_REQUESTED_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return url.toString();
}

/**
 * Speaks to Google's token endpoint and the Drive API for the OAuth client of the instance.
 *
 * @remarks
 * No method logs or returns Google's raw answer, so neither tokens nor account
 * details reach a log.
 */
export class GoogleDriveApiClient {
  private readonly application: GoogleOAuthApplication;
  private readonly fetcher: GoogleFetch;
  private readonly now: () => number;

  /**
   * Creates the client.
   *
   * @param application - The OAuth client of the instance.
   * @param options - Stand-ins for `fetch` and the clock.
   */
  public constructor(
    application: GoogleOAuthApplication,
    options: {
      readonly fetcher?: GoogleFetch;
      readonly now?: () => number;
    } = {},
  ) {
    this.application = application;
    this.fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? Date.now;
  }

  /**
   * Exchanges the authorization code of the callback for tokens.
   *
   * @param input - The code, the redirect URI of the sign-in and the PKCE verifier.
   * @returns The tokens, or why Google refused them.
   */
  public async exchangeCode(input: {
    readonly code: string;
    readonly redirectUri: string;
    readonly codeVerifier: string;
  }): Promise<GoogleCallResult<GoogleTokenGrant>> {
    return this.requestToken({
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
    });
  }

  /**
   * Renews an access token with the stored refresh token, without the person.
   *
   * @param refreshToken - The stored refresh token.
   * @returns A new access token, or why Google refused it.
   */
  public async refresh(
    refreshToken: string,
  ): Promise<GoogleCallResult<GoogleTokenGrant>> {
    return this.requestToken({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  }

  /**
   * Reads the account behind an access token with `about.get`.
   *
   * @param accessToken - A current access token.
   * @returns The account, or why Drive refused the request.
   *
   * @remarks
   * The request reads two account fields and nothing else: no file, no
   * content, no change.
   */
  public async readAccount(
    accessToken: string,
  ): Promise<GoogleCallResult<GoogleDriveAccount>> {
    const response = await this.send(ABOUT_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      method: "GET",
    });

    if (!response) {
      return { ok: false, problem: "google_unreachable" };
    }

    const body = await readJson(response);

    if (!response.ok) {
      return { ok: false, problem: driveProblem(response.status, body) };
    }

    const user = isRecord(body) && isRecord(body["user"]) ? body["user"] : null;
    const permissionId = user ? readString(user, "permissionId") : "";

    if (!user || permissionId === "") {
      return { ok: false, problem: "google_unreachable" };
    }

    const emailAddress = readString(user, "emailAddress");

    return {
      ok: true,
      value: {
        emailAddress: emailAddress === "" ? null : emailAddress,
        permissionId,
      },
    };
  }

  private async requestToken(
    parameters: Record<string, string>,
  ): Promise<GoogleCallResult<GoogleTokenGrant>> {
    const response = await this.send(TOKEN_URL, {
      body: new URLSearchParams({
        ...parameters,
        client_id: this.application.clientId,
        client_secret: this.application.clientSecret,
      }).toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });

    if (!response) {
      return { ok: false, problem: "google_unreachable" };
    }

    const body = await readJson(response);

    if (!response.ok) {
      return { ok: false, problem: tokenProblem(response.status, body) };
    }

    const grant = readGrant(body, this.now());

    return grant
      ? { ok: true, value: grant }
      : { ok: false, problem: "google_unreachable" };
  }

  private async send(url: string, init: RequestInit): Promise<Response | null> {
    return sendGoogleRequest(this.fetcher, url, init);
  }
}
