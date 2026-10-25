import { useEffect, useRef, useState } from "react";

import { sessionAddress } from "./console-target";
import { mergeEvents, readSessionPage } from "./session-client";

import type {
  AgentSessionEvent,
  AgentSessionEventPage,
  AgentSessionKey,
  AgentSessionView,
} from "@/definition/AgentSessionJournal";

// Live events ask for a fresh view at most this often, so usage and state follow without polling.
const VIEW_REFRESH_DELAY = 1500;
// A stream the server refused is opened again after this delay, doubled up to the maximum.
const REOPEN_DELAY = 5000;
const MAXIMUM_REOPEN_DELAY = 60_000;

/** How the console currently receives live events. */
export type SessionConnection =
  "loading" | "connecting" | "live" | "reconnecting" | "closed";

interface SessionState {
  readonly view: AgentSessionView | null;
  readonly events: readonly AgentSessionEvent[];
  readonly source: AgentSessionEventPage["source"];
  readonly retainedFrom: number | null;
  readonly error: string | null;
}

/** The data of one session as the console shows it. */
export interface AgentSessionData extends SessionState {
  readonly connection: SessionConnection;
  /** Reads view and missed events again, for example after an instruction. */
  readonly refresh: () => void;
}

const INITIAL: SessionState = {
  view: null,
  events: [],
  source: "journal",
  retainedFrom: null,
  error: null,
};

type SetSessionState = React.Dispatch<React.SetStateAction<SessionState>>;

function isSessionEvent(input: unknown): input is AgentSessionEvent {
  return (
    typeof input === "object" &&
    input !== null &&
    "sequence" in input &&
    typeof input.sequence === "number" &&
    "kind" in input &&
    "text" in input
  );
}

/** Reads every page after the cursor, so a reconnect or refresh fills each gap once. */
async function readPages(
  address: string,
  cursor: { current: number },
  signal: AbortSignal,
  setState: SetSessionState,
): Promise<void> {
  for (;;) {
    const result = await readSessionPage(address, cursor.current, signal);
    if (signal.aborted) return;
    if (!result.ok) {
      setState((current) => ({ ...current, error: result.error }));
      return;
    }
    const { page, view } = result;
    cursor.current = Math.max(cursor.current, page.cursor ?? 0);
    setState((current) => ({
      view,
      events: mergeEvents(current.events, page.events),
      source: page.source,
      retainedFrom: page.retainedFrom,
      error: null,
    }));
    if (!page.hasMore || page.events.length === 0) return;
  }
}

/**
 * Follows live events of an active run over one event stream.
 *
 * @remarks
 * The browser reconnects a dropped stream with the last sequence itself; a
 * stream the server answered with an error is opened again after a delay
 * that grows, as long as the run is active.
 */
function useSessionStream(
  address: string,
  options: {
    readonly isLive: boolean;
    readonly cursor: { current: number };
    readonly setState: SetSessionState;
    readonly onActivity: () => void;
  },
): SessionConnection {
  const [connection, setConnection] = useState<SessionConnection>("connecting");
  const [opening, setOpening] = useState(0);
  const reopenDelay = useRef(REOPEN_DELAY);
  const { isLive, cursor, setState, onActivity } = options;
  const activity = useRef(onActivity);
  useEffect(() => {
    activity.current = onActivity;
  });
  useEffect(() => {
    if (!isLive) return undefined;
    let reopenTimer: number | null = null;
    const source = new EventSource(`${address}&after=${cursor.current}`);
    source.onopen = () => {
      reopenDelay.current = REOPEN_DELAY;
      setConnection("live");
    };
    source.onerror = () => {
      setConnection("reconnecting");
      if (source.readyState !== EventSource.CLOSED || reopenTimer !== null)
        return;
      const delay = reopenDelay.current;
      reopenDelay.current = Math.min(delay * 2, MAXIMUM_REOPEN_DELAY);
      reopenTimer = window.setTimeout(
        () => setOpening((value) => value + 1),
        delay,
      );
    };
    source.addEventListener("session", (message) => {
      const event: unknown = JSON.parse(String(message.data));
      if (!isSessionEvent(event)) return;
      cursor.current = Math.max(cursor.current, event.sequence);
      setState((current) => ({
        ...current,
        events: mergeEvents(current.events, [event]),
      }));
      activity.current();
    });
    return () => {
      source.close();
      if (reopenTimer !== null) window.clearTimeout(reopenTimer);
      setConnection("connecting");
    };
  }, [address, isLive, cursor, setState, opening]);
  return isLive ? connection : "closed";
}

/**
 * Reads, follows and refreshes one PageAgentCLI session.
 *
 * @param key - The session; the caller remounts the console for another
 * session, so data of one session never shows under the next.
 * @param options - Whether the run is active, and a value that changes with the node's status.
 * @remarks
 * Opening reads the journal only and starts no process. Closing the console
 * aborts open reads and ends the stream, never the session or the run.
 */
export function useAgentSession(
  key: AgentSessionKey,
  options: {
    readonly isLive: boolean;
    readonly status: string;
    readonly isRemote?: boolean;
  },
): AgentSessionData {
  const address = sessionAddress(key);
  const [state, setState] = useState<SessionState>(INITIAL);
  const [revision, setRevision] = useState(0);
  const cursor = useRef(0);
  const refreshTimer = useRef<number | null>(null);
  const { isLive, status, isRemote = false } = options;

  useEffect(() => {
    const controller = new AbortController();
    void readPages(address, cursor, controller.signal, setState);
    return () => controller.abort();
  }, [address, revision, status, isLive]);

  useEffect(
    () => () => {
      if (refreshTimer.current !== null)
        window.clearTimeout(refreshTimer.current);
    },
    [],
  );

  function scheduleRefresh(): void {
    if (isRemote) return;
    refreshTimer.current ??= window.setTimeout(() => {
      refreshTimer.current = null;
      setRevision((value) => value + 1);
    }, VIEW_REFRESH_DELAY);
  }

  const connection = useSessionStream(sessionAddress(key, "/events"), {
    isLive,
    cursor,
    setState,
    onActivity: scheduleRefresh,
  });
  const isLoading = state.view === null && state.error === null;
  return {
    ...state,
    connection: isLoading ? "loading" : connection,
    refresh: () => setRevision((value) => value + 1),
  };
}
