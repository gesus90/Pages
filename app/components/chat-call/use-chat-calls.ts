import { createContext, useContext, useEffect, useRef, useState } from "react";

import { backendRequestHeaders } from "@/app/lib/backend-request";
import { CHAT_CALLS_ENDPOINT, isChatCallList } from "@/definition/ChatCall";

import type { ChatCallAction, ChatCallView } from "@/definition/ChatCall";

/** The safety net while no live notice arrives; live notices read at once. */
const REFRESH_MILLISECONDS = 10_000;

/** The calls of the signed-in account and what the page can do with them. */
export interface ChatCallsState {
  readonly calls: readonly ChatCallView[];
  /** Reads the calls again, for a live notice. */
  readonly refresh: () => void;
  /** Rings the person of a direct chat; `true` when the server took the call. */
  readonly start: (participantId: string) => Promise<boolean>;
  /** Answers, cancels or ends a call; `true` when the server took the action. */
  readonly respond: (
    callId: string,
    action: ChatCallAction,
  ) => Promise<boolean>;
}

const NO_CALLS: readonly ChatCallView[] = [];

/**
 * Shares the calls of the signed-in account with the notice and the chat page;
 * outside it there are no calls and nothing to change.
 */
export const ChatCallsContext = createContext<ChatCallsState>({
  calls: NO_CALLS,
  refresh: () => undefined,
  start: () => Promise.resolve(false),
  respond: () => Promise.resolve(false),
});

/** Reads the calls the page follows; without a provider it holds no calls. */
export function useChatCalls(): ChatCallsState {
  return useContext(ChatCallsContext);
}

async function readCalls(
  signal: AbortSignal,
): Promise<readonly ChatCallView[]> {
  const response = await fetch(CHAT_CALLS_ENDPOINT, {
    headers: backendRequestHeaders({ Accept: "application/json" }),
    signal,
  });
  if (!response.ok) throw new Error("Chat calls unavailable.");
  const payload: unknown = await response.json();
  if (!isChatCallList(payload)) throw new Error("Chat calls invalid.");
  return payload.calls;
}

async function postCall(body: object): Promise<boolean> {
  try {
    const response = await fetch(CHAT_CALLS_ENDPOINT, {
      method: "POST",
      headers: backendRequestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch (error: unknown) {
    console.warn("The chat call could not be sent.", error);
    return false;
  }
}

/**
 * Follows the calls of the signed-in account.
 * @remarks
 * The server decides who rings whom and who may answer; the page only shows
 * what it reads. Live notices of conversations call `refresh`, and a slow
 * interval reads the calls while the page is visible.
 */
export function useChatCallsState(): ChatCallsState {
  const [calls, setCalls] = useState<readonly ChatCallView[]>(NO_CALLS);
  const readRef = useRef<() => void>(() => undefined);
  const refreshRef = useRef(() => readRef.current());

  useEffect(() => {
    const controller = new AbortController();
    let latest = 0;
    function read(): void {
      latest += 1;
      const reading = latest;
      readCalls(controller.signal)
        .then((next) => {
          if (reading === latest) setCalls(next);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted)
            console.warn("Chat calls could not refresh.", error);
        });
    }
    readRef.current = read;
    read();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") read();
    }, REFRESH_MILLISECONDS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      readRef.current = () => undefined;
    };
  }, []);

  async function send(body: object): Promise<boolean> {
    const isTaken = await postCall(body);
    readRef.current();
    return isTaken;
  }

  return {
    calls,
    refresh: refreshRef.current,
    start: (participantId) => send({ intent: "start", participantId }),
    respond: (callId, action) => send({ intent: "respond", callId, action }),
  };
}
