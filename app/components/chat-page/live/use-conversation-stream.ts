import { useEffect, useReducer, useRef, useState } from "react";
import { useRevalidator } from "react-router";

import {
  CONVERSATION_WEB_SOCKET_PATH,
  LIVE_ANSWER_EVENT_TYPES,
} from "@/definition/ConversationLiveAnswer";

import { applyLiveAnswerAction, EMPTY_LIVE_STATE } from "./live-answer-state";

import type { LiveAnswerEventPayload } from "@/definition/ConversationLiveAnswer";
import type { LiveAnswerState } from "./live-answer-state";

/** The version of the protocol of Pica Mobile the page speaks. */
const PROTOCOL_VERSION = 1;
/** The first wait before a new attempt; it doubles up to the longest wait. */
const FIRST_RETRY_MILLISECONDS = 1_000;
const LONGEST_RETRY_MILLISECONDS = 15_000;
/** Gathers the ends of several answers into one reading of the page. */
const REVALIDATE_GATHER_MILLISECONDS = 150;

/** What the chat page knows of the answers being written, and of its connection. */
export interface ConversationStream {
  readonly state: LiveAnswerState;
  /** Whether the channel is open and signed in. */
  readonly isConnected: boolean;
}

/** What the hook needs from the browser; tests replace it. */
export interface ConversationStreamOptions {
  readonly createSocket?: (url: string) => WebSocket;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLiveType(type: unknown): type is LiveAnswerEventPayload["type"] {
  return LIVE_ANSWER_EVENT_TYPES.some((known) => known === type);
}

function isAnswerSyncComplete(frame: unknown): boolean {
  return (
    isRecord(frame) &&
    frame.type === "conversation_event" &&
    isRecord(frame.payload) &&
    frame.payload.type === "answer_sync_complete" &&
    isRecord(frame.payload.data)
  );
}

/**
 * The live part a frame carries, or `null` for every other frame.
 * @remarks
 * Only the shape that tells parts apart is checked: the server is the
 * page's own, and an unknown event is ignored, as the protocol asks.
 */
export function readLivePayload(frame: unknown): LiveAnswerEventPayload | null {
  if (!isRecord(frame) || frame.type !== "conversation_event") return null;
  const { payload } = frame;
  if (!isRecord(payload) || !isLiveType(payload.type)) return null;
  const { data: eventData } = payload;
  if (
    !isRecord(eventData) ||
    typeof eventData.answerId !== "string" ||
    typeof eventData.seq !== "number"
  )
    return null;
  return payload as unknown as LiveAnswerEventPayload;
}

function socketUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}${CONVERSATION_WEB_SOCKET_PATH}`;
}

function authFrame(): string {
  // The connection takes the session of the page's cookie; the page cannot read it.
  return JSON.stringify({
    version: PROTOCOL_VERSION,
    type: "auth",
    requestId: "web-auth",
    payload: { method: "session", token: "cookie" },
  });
}

function readFrame(text: unknown): unknown {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Reads the page again once for a burst of calls. */
function useGatheredRevalidate(): () => void {
  const { revalidate } = useRevalidator();
  const revalidateRef = useRef(revalidate);
  const timer = useRef(0);
  useEffect(() => {
    revalidateRef.current = revalidate;
  }, [revalidate]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const schedule = useRef(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void revalidateRef.current();
    }, REVALIDATE_GATHER_MILLISECONDS);
  });
  return schedule.current;
}

/**
 * Follows the answers agents are writing over `conversations.v1` on the
 * Pages port.
 * @remarks
 * The page connects with the session of its cookie and the server's rights
 * checks; it receives only the parts of chats its account belongs to, and
 * thoughts only where it may read them. A lost connection is opened again
 * with a growing wait. After sign-in the server confirms which answers it
 * still holds. When every snapshot arrived, the page drops missing answers
 * and reloads its history after a reconnect. The end
 * of an answer reads the page once, so the stored message takes its place.
 * There is no reading at fixed intervals.
 */
export function useConversationStream(
  options: ConversationStreamOptions = {},
): ConversationStream {
  const [state, dispatch] = useReducer(applyLiveAnswerAction, EMPTY_LIVE_STATE);
  const [isConnected, setConnected] = useState(false);
  const revalidate = useGatheredRevalidate();
  const createSocket = useRef(
    options.createSocket ?? ((url: string) => new WebSocket(url)),
  );

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer = 0;
    let wait = FIRST_RETRY_MILLISECONDS;
    let hasConnected = false;
    let isReconnecting = false;
    let isClosed = false;

    function handleFrame(frame: unknown): void {
      if (isRecord(frame) && frame.type === "connected") {
        wait = FIRST_RETRY_MILLISECONDS;
        setConnected(true);
        dispatch({ type: "answer_sync_started" });
        isReconnecting = hasConnected;
        hasConnected = true;
        if (isReconnecting) revalidate();
        return;
      }
      if (isAnswerSyncComplete(frame)) {
        dispatch({ type: "answer_sync_complete" });
        if (isReconnecting) revalidate();
        isReconnecting = false;
        return;
      }
      const payload = readLivePayload(frame);
      if (payload === null) return;
      dispatch(payload);
      if (payload.type === "answer_end") revalidate();
    }

    function connect(): void {
      if (isClosed) return;
      const current = createSocket.current(socketUrl());
      socket = current;
      current.addEventListener("open", () => current.send(authFrame()));
      current.addEventListener("message", (event: MessageEvent) => {
        if (socket === current) handleFrame(readFrame(event.data));
      });
      current.addEventListener("close", () => {
        if (socket !== current) return;
        socket = null;
        setConnected(false);
        if (isClosed) return;
        dispatch({ type: "answer_sync_interrupted" });
        retryTimer = window.setTimeout(connect, wait);
        wait = Math.min(wait * 2, LONGEST_RETRY_MILLISECONDS);
      });
    }

    connect();
    return () => {
      isClosed = true;
      window.clearTimeout(retryTimer);
      socket?.close(1000, "Chat page closed");
      socket = null;
    };
  }, [revalidate]);

  return { state, isConnected };
}
