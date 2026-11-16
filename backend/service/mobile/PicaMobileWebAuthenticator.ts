import type {
  PicaMobileAuthenticator,
  PicaMobileAuthOutcome,
  PicaMobileClientOrigin,
} from "./PicaMobileAuthenticator";
import type { PicaMobileAuthPayload } from "@/definition/PicaMobileProtocol";

/**
 * Authenticates the `conversations.v1` connection of the signed-in browser
 * with the session of its cookie.
 * @remarks
 * The page cannot read its HttpOnly session cookie, so its `auth` message
 * names the method `session` without the real token; the connection uses
 * the token the handshake presented. The session is checked as every other
 * one, and a password is refused: the browser signs in on the web only.
 */
export class PicaMobileWebAuthenticator implements PicaMobileAuthenticator {
  private readonly inner: PicaMobileAuthenticator;
  private readonly sessionToken: string;

  /**
   * Creates the authenticator of one browser connection.
   * @param inner - Checks sessions against the Pages accounts.
   * @param sessionToken - The session of the handshake's cookie.
   */
  public constructor(inner: PicaMobileAuthenticator, sessionToken: string) {
    this.inner = inner;
    this.sessionToken = sessionToken;
  }

  /** Resumes the cookie's session; any other credential is refused. */
  public authenticate(
    credentials: PicaMobileAuthPayload,
    origin: PicaMobileClientOrigin,
  ): Promise<PicaMobileAuthOutcome> {
    if (credentials.method !== "session")
      return Promise.resolve({ ok: false, reason: "invalidCredentials" });
    return this.inner.authenticate(
      { method: "session", token: this.sessionToken },
      origin,
    );
  }

  /** Tells whether the cookie's session still holds. */
  public isSessionActive(sessionToken: string): Promise<boolean> {
    return this.inner.isSessionActive(sessionToken);
  }
}
