import { LIVE_CHANGE_EVENT, readLiveChange } from "@/definition/LiveChange";

import type { LiveChange } from "@/definition/LiveChange";

/** First wait before a refused stream is opened again; it doubles up to the maximum. */
const FIRST_RECONNECT_MILLISECONDS = 3000;
const MAXIMUM_RECONNECT_MILLISECONDS = 60_000;

/** What the live connection reports to the page. */
export interface LiveConnectionHandlers {
  /** One object the account may see changed. */
  readonly onChange: (change: LiveChange) => void;
  /** Everything may have changed: rights, a missed stretch after a gap. */
  readonly onResync: () => void;
  /** Whether notices arrive right now. */
  readonly onLiveChange: (isLive: boolean) => void;
}

/** The address of the stream; `after` lets `pages-core` continue after the last notice. */
function streamUrl(version: string, cursor: string): string {
  const base = `/live-changes?version=${encodeURIComponent(version)}`;
  return cursor ? `${base}&after=${encodeURIComponent(cursor)}` : base;
}

/**
 * Keeps one SSE stream to `/live-changes` open and reports what it hears.
 *
 * @remarks
 * The browser connects again on its own once after a network gap, so a short
 * gap closes fast. When that fails too, or the server refuses the stream, for
 * instance after the session ended, the stream is closed and a new one opens
 * after a growing wait, so an unreachable stream costs few requests. Every opening reports
 * `onResync`: the first one, because a change may have come between the
 * page's loading and the subscription, and every later one, because notices
 * of the gap are not repeated. When `pages-core` serves the stream, its
 * notices carry an opaque cursor as event id; the browser sends it back on
 * its own reconnect, and a new stream names it as `after`, so the core
 * continues right after it. The API's own stream ignores both.
 *
 * @param version - The authorization fingerprint the page was loaded with.
 * @param handlers - Receive notices and the live state.
 * @returns Closes the stream and stops reconnecting.
 */
export function openLiveConnection(
  version: string,
  handlers: LiveConnectionHandlers,
): () => void {
  let cursor = "";
  let source: EventSource | undefined;
  let reconnectTimer: number | undefined;
  let reconnectWait = FIRST_RECONNECT_MILLISECONDS;
  let isClosed = false;
  let failures = 0;
  function handleOpen(): void {
    failures = 0;
    reconnectWait = FIRST_RECONNECT_MILLISECONDS;
    handlers.onLiveChange(true);
    handlers.onResync();
  }
  function handleError(): void {
    handlers.onLiveChange(false);
    failures += 1;
    if (source?.readyState !== EventSource.CLOSED && failures < 2) return;
    source?.close();
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(connect, reconnectWait);
    reconnectWait = Math.min(reconnectWait * 2, MAXIMUM_RECONNECT_MILLISECONDS);
  }
  function handleChange(event: MessageEvent<string>): void {
    if (event.lastEventId) cursor = event.lastEventId;
    const change = readLiveChange(event.data);
    if (change) handlers.onChange(change);
  }
  function handleResync(event: MessageEvent<string>): void {
    if (event.lastEventId) cursor = event.lastEventId;
    handlers.onResync();
  }
  function connect(): void {
    if (isClosed) return;
    source?.close();
    source = new EventSource(streamUrl(version, cursor));
    source.addEventListener("open", handleOpen);
    source.addEventListener("error", handleError);
    source.addEventListener(LIVE_CHANGE_EVENT.CHANGE, handleChange);
    source.addEventListener(LIVE_CHANGE_EVENT.RESYNC, handleResync);
  }
  connect();
  return () => {
    isClosed = true;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    if (!source) return;
    source.removeEventListener("open", handleOpen);
    source.removeEventListener("error", handleError);
    source.removeEventListener(LIVE_CHANGE_EVENT.CHANGE, handleChange);
    source.removeEventListener(LIVE_CHANGE_EVENT.RESYNC, handleResync);
    source.close();
  };
}
