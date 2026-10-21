/**
 * Draft contracts for Pica conversations.
 *
 * @remarks
 * Pages does not serve a mobile API yet. These types fix the vocabulary the app
 * code is written against; the ticket that adds the API aligns them with the
 * server and implements `PicaSessionApi` on top of `PagesClient`. Nothing in the
 * app produces or fakes values of these types.
 */

/** How the server side of a conversation stands, as the Pica chat reports it. */
export type PicaSessionState =
  "idle" | "running" | "completed" | "failed" | "stopped" | "interrupted";

/** One conversation in the list of sessions. */
export interface PicaSessionSummary {
  readonly id: string;
  readonly title: string;
  readonly state: PicaSessionState;
  /** ISO 8601 time of the last change. */
  readonly updatedAt: string;
}

/** Who wrote a message. */
export type PicaMessageRole = "user" | "assistant";

/** One message of a conversation. */
export interface PicaMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly role: PicaMessageRole;
  readonly text: string;
  /** ISO 8601 time the message was created. */
  readonly createdAt: string;
}

/** Operations on the sessions of the signed-in person. */
export interface PicaSessionApi {
  listSessions(options?: {
    signal?: AbortSignal;
  }): Promise<PicaSessionSummary[]>;
  listMessages(
    sessionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<PicaMessage[]>;
  sendMessage(
    sessionId: string,
    text: string,
    options?: { signal?: AbortSignal },
  ): Promise<PicaMessage>;
}
