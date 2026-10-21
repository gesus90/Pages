import type { PicaMessage, PicaSessionState } from "./pica-session";

/**
 * Draft contract for live events of a Pica session.
 *
 * @remarks
 * The transport (server-sent events or a WebSocket) is decided by the ticket
 * that adds the real-time connection. The union is closed, so a handler that
 * switches over `type` fails to compile when an event is added.
 */
export type PicaLiveEvent =
  | { readonly type: "message.created"; readonly message: PicaMessage }
  | {
      readonly type: "message.delta";
      readonly sessionId: string;
      readonly messageId: string;
      readonly textDelta: string;
    }
  | {
      readonly type: "session.state";
      readonly sessionId: string;
      readonly state: PicaSessionState;
    };

/** Where a live connection stands. */
export type LiveConnectionState =
  "connecting" | "open" | "reconnecting" | "closed";

/** Handlers of a live subscription. */
export interface LiveEventListener {
  onEvent(event: PicaLiveEvent): void;
  onStateChange(state: LiveConnectionState): void;
}

/** A running subscription; closing it releases the connection. */
export interface LiveEventSubscription {
  close(): void;
}

/** Opens live subscriptions to the events of one session. */
export interface LiveEventSource {
  subscribe(
    sessionId: string,
    listener: LiveEventListener,
  ): LiveEventSubscription;
}
