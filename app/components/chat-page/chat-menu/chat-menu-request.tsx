import { createContext, useContext, useState } from "react";

import type { VirtualChatSelection } from "@/definition/VirtualChat";

/** A point of the viewport in CSS pixels, where the menu opens. */
export interface ChatMenuPoint {
  readonly x: number;
  readonly y: number;
}

/** The wish to open the chat menu of a conversation of the list at a point. */
export interface ChatMenuRequest {
  readonly selection: VirtualChatSelection;
  readonly point: ChatMenuPoint;
  /** Counts the requests, so a second right click on the same chat opens it anew. */
  readonly stamp: number;
}

/** The pending request and how the list makes and the head ends one. */
export interface ChatMenuRequestState {
  readonly request: ChatMenuRequest | null;
  open(selection: VirtualChatSelection, point: ChatMenuPoint): void;
  close(): void;
}

const NO_REQUESTS: ChatMenuRequestState = {
  request: null,
  open: () => undefined,
  close: () => undefined,
};

/** Carries the request from the list of chats to the head of the opened chat. */
export const ChatMenuRequestContext =
  createContext<ChatMenuRequestState>(NO_REQUESTS);

/**
 * Keeps the request to open the chat menu from the list; the chat page
 * holds it and provides it with {@link ChatMenuRequestContext}.
 */
export function useChatMenuRequestState(): ChatMenuRequestState {
  const [request, setRequest] = useState<ChatMenuRequest | null>(null);
  return {
    request,
    open: (selection, point) =>
      setRequest((previous) => ({
        selection,
        point,
        stamp: (previous?.stamp ?? 0) + 1,
      })),
    close: () => setRequest(null),
  };
}

/** The request of the list as the list and the head read it. */
export function useChatMenuRequest(): ChatMenuRequestState {
  return useContext(ChatMenuRequestContext);
}

/**
 * The point a request asks the menu of the given chat to open at, and how
 * the head ends the request; `point` is `null` for any other chat.
 */
export function useChatMenuAnchor(selection: VirtualChatSelection): {
  readonly point: ChatMenuPoint | null;
  readonly stamp: number;
  close(): void;
} {
  const { request, close } = useChatMenuRequest();
  const isMine =
    request !== null &&
    request.selection.kind === selection.kind &&
    request.selection.id === selection.id;
  return {
    point: isMine ? request.point : null,
    stamp: isMine ? request.stamp : 0,
    close,
  };
}
