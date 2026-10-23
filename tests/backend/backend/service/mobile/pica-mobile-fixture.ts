import { vi } from "vitest";

import type {
  PicaMobileAuthenticator,
  PicaMobileAuthOutcome,
} from "@/backend/service/mobile/PicaMobileAuthenticator";
import type { PicaMobileChannel } from "@/backend/service/mobile/PicaMobileConnection";

/** A decoded server message, as a client reads it. */
export interface ReceivedMessage {
  readonly version: number;
  readonly type: string;
  readonly requestId: string | null;
  readonly payload: Record<string, unknown>;
}

/** A WebSocket stand-in that records what the connection does to it. */
export class FakeChannel implements PicaMobileChannel {
  public readonly sent: string[] = [];
  public readonly closes: { code: number; reason: string }[] = [];
  public terminateCount = 0;
  public pingCount = 0;
  public failSending = false;

  /** Records the frame, or fails like a socket that is not open. */
  public send(text: string): void {
    if (this.failSending) {
      throw new Error("socket is not open");
    }

    this.sent.push(text);
  }

  /** Records the closing handshake the connection starts. */
  public close(code: number, reason: string): void {
    this.closes.push({ code, reason });
  }

  /** Counts the hard cuts. */
  public terminate(): void {
    this.terminateCount += 1;
  }

  /** Counts the heartbeat probes. */
  public ping(): void {
    this.pingCount += 1;
  }

  /** Every message sent so far, decoded. */
  public messages(): ReceivedMessage[] {
    return this.sent.map((text) => JSON.parse(text) as ReceivedMessage);
  }

  /** The error codes sent so far. */
  public errorCodes(): unknown[] {
    return this.messages()
      .filter((message) => message.type === "error")
      .map((message) => message.payload.code);
  }
}

/** The outcome an account named "anna" gets from the fake authenticator. */
export const ANNA_OUTCOME: Extract<PicaMobileAuthOutcome, { ok: true }> = {
  ok: true,
  user: { id: "user-anna", username: "anna", displayName: "Anna Beispiel" },
  sessionToken: "session-token-anna",
  isSessionIssued: false,
};

/** An authenticator whose answers a test sets. */
export class FakeAuthenticator implements PicaMobileAuthenticator {
  public readonly authenticate = vi.fn<
    PicaMobileAuthenticator["authenticate"]
  >(async () => ANNA_OUTCOME);
  public readonly isSessionActive = vi.fn<
    PicaMobileAuthenticator["isSessionActive"]
  >(async () => true);
}

/** Builds the text of a client message. */
export function clientMessage(
  type: string,
  payload: Record<string, unknown> = {},
  requestId = "r-1",
): string {
  return JSON.stringify({ version: 1, type, requestId, payload });
}

/** Builds an `auth` message with a session token. */
export function sessionAuth(requestId = "auth-1"): string {
  return clientMessage(
    "auth",
    { method: "session", token: "session-token-anna" },
    requestId,
  );
}
