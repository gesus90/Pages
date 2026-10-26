import { useEffect, useRef, useState } from "react";

import { sessionAddress } from "./console-target";
import { mergeEvents, readSessionPage } from "./session-client";
import { useSessionStream } from "./session-stream";
import { useSessionRefresh } from "./use-session-refresh";

import type { SessionConnection } from "./session-stream";
import type {
  AgentSessionEvent,
  AgentSessionEventPage,
  AgentSessionKey,
  AgentSessionView,
} from "@/definition/AgentSessionJournal";

interface SessionState {
  readonly view: AgentSessionView | null;
  readonly events: readonly AgentSessionEvent[];
  readonly source: AgentSessionEventPage["source"];
  readonly retainedFrom: number | null;
  readonly hasEarlier: boolean;
  readonly error: string | null;
}

/** A bounded console window plus explicit server-side navigation. */
export interface AgentSessionData extends SessionState {
  readonly connection: SessionConnection;
  readonly isHistoryLoading: boolean;
  readonly isFollowing: boolean;
  readonly refresh: () => void;
  readonly loadEarlier: () => void;
  readonly followLatest: () => void;
  readonly stopFollowing: () => void;
  readonly downloadAddress: string;
}

const INITIAL: SessionState = {
  view: null,
  events: [],
  source: "journal",
  retainedFrom: null,
  hasEarlier: false,
  error: null,
};

function windowEvents(
  current: SessionState,
  incoming: AgentSessionEventPage,
  before: number | null,
  isFollowing: boolean,
): readonly AgentSessionEvent[] {
  if (before !== null || current.view === null)
    return mergeEvents([], incoming.events);
  return isFollowing
    ? mergeEvents(current.events, incoming.events)
    : current.events;
}

function appendLiveEvent(
  current: SessionState,
  event: AgentSessionEvent,
): SessionState {
  return {
    ...current,
    events: mergeEvents(current.events, [event]),
    hasEarlier: current.hasEarlier || current.events.length >= 150,
  };
}

/** Reads a small tail, follows in sequence and replaces the window when the reader requests older events. */
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
  const [before, setBefore] = useState<number | null>(null);
  const [isFollowing, setFollowing] = useState(true);
  const [isHistoryLoading, setHistoryLoading] = useState(true);
  const onActivity = useSessionRefresh(!options.isRemote, () =>
    setRevision((current) => current + 1),
  );
  const cursor = useRef(0);
  const following = useRef(isFollowing);
  useEffect(() => {
    following.current = isFollowing;
  }, [isFollowing]);
  const { status } = options;
  useEffect(() => {
    const controller = new AbortController();
    setHistoryLoading(true);
    async function read(): Promise<void> {
      const result = await readSessionPage(
        address,
        0,
        controller.signal,
        before === null ? { tail: true } : { before },
      );
      if (controller.signal.aborted) return;
      setHistoryLoading(false);
      if (!result.ok) {
        setState((current) => ({ ...current, error: result.error }));
        return;
      }
      cursor.current = Math.max(cursor.current, result.page.cursor ?? 0);
      setState((current) => ({
        view: result.view,
        events: windowEvents(current, result.page, before, following.current),
        source: result.page.source,
        retainedFrom: result.page.retainedFrom,
        hasEarlier:
          (result.page.hasEarlier ?? false) || result.page.events.length > 150,
        error: null,
      }));
    }
    void read();
    return () => controller.abort();
  }, [address, revision, status, before]);
  const connection = useSessionStream({
    address: sessionAddress(key, "/events"),
    isLive: options.isLive && state.view !== null,
    cursor,
    onEvent: (event) => {
      onActivity();
      if (window.getSelection()?.toString()) {
        following.current = false;
        setFollowing(false);
      }
      setState((current) =>
        following.current ? appendLiveEvent(current, event) : current,
      );
    },
    onGap: (retainedFrom) =>
      setState((current) => ({ ...current, retainedFrom })),
    onError: (error) => setState((current) => ({ ...current, error })),
  });
  function followLatest(): void {
    following.current = true;
    setFollowing(true);
    setBefore(null);
    setRevision((current) => current + 1);
  }
  return {
    ...state,
    connection:
      state.view === null && state.error === null ? "loading" : connection,
    isHistoryLoading,
    isFollowing,
    downloadAddress: sessionAddress(key, "/download"),
    refresh: () => setRevision((current) => current + 1),
    loadEarlier: () => {
      following.current = false;
      setFollowing(false);
      setBefore(state.events[0]?.sequence ?? null);
      setRevision((current) => current + 1);
    },
    followLatest,
    stopFollowing: () => {
      following.current = false;
      setFollowing(false);
    },
  };
}
