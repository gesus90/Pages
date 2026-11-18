import { useEffect, useRef } from "react";

import { saveReadingPosition } from "./chat-view-requests";

/** How near the foot of the history counts as reading the newest message, in pixels. */
const FOOT_TOLERANCE_PIXELS = 48;

/** How long after the last scrolling the reading position is stored, in milliseconds. */
const SAVE_DELAY_MILLISECONDS = 400;

/** How many older pages the history loads at most to reach the stored message. */
const MAXIMUM_OLDER_PAGES = 10;

/** The ID of a message that is on its way and has no stored place yet. */
const PENDING_MESSAGE_ID = "pending";

/** The older pages of the history that placing the view may load. */
export interface PositionOlderPages {
  readonly hasMore: boolean;
  readonly isLoading: boolean;
  readonly onLoad: () => void;
}

/** What the history tells about the opened chat. */
export interface HistoryPositionInput {
  /** The key of the opened chat, such as `group:…`. */
  readonly chatKey: string;
  /** Where the person stopped reading in each chat, as the page read it. */
  readonly stored: Readonly<Record<string, string>> | undefined;
  /** The IDs of the shown messages, oldest first. */
  readonly messageIds: readonly string[];
  /** Whether a link names the message to show; it replaces the stored position. */
  readonly hasFocusRequest: boolean;
  readonly older: PositionOlderPages;
  /** The foot of the history: the newest message and what grows below it. */
  readonly foot: {
    readonly newestId: string | null;
    /** Whether the newest message is the person's own. */
    readonly isOwn: boolean;
    /** Changes whenever something below the newest message grows. */
    readonly growth: string;
  };
}

interface PendingPosition {
  readonly chatKey: string;
  readonly messageId: string | null;
}

/** What the hooks of the history share while the page is open. */
interface PositionState {
  /** Where the person stopped reading by chat key; a chat read to its end has no entry. */
  readonly positions: Map<string, string>;
  /** The chat whose view was placed. */
  placedChat: string | null;
  /** The chat the older pages are loaded for, with how many were asked for. */
  loadingChat: string | null;
  loadedPages: number;
  /** The shown message count an older page was last asked for at. */
  requestedAt: number | null;
  /** Whether new messages and the growing answer keep the foot in view. */
  isFollowing: boolean;
  /** The position of the last scrolling, not stored yet. */
  pending: PendingPosition | null;
}

function createState(
  stored: Readonly<Record<string, string>> | undefined,
): PositionState {
  return {
    positions: new Map(Object.entries(stored ?? {})),
    placedChat: null,
    loadingChat: null,
    loadedPages: 0,
    requestedAt: null,
    isFollowing: true,
    pending: null,
  };
}

function messageElements(viewport: HTMLElement): HTMLElement[] {
  return [...viewport.querySelectorAll<HTMLElement>("[data-message-id]")];
}

function findMessage(
  viewport: HTMLElement,
  messageId: string,
): HTMLElement | null {
  return (
    messageElements(viewport).find(
      (element) => element.dataset.messageId === messageId,
    ) ?? null
  );
}

function isNearFoot(viewport: HTMLElement): boolean {
  const distance =
    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  return distance <= FOOT_TOLERANCE_PIXELS;
}

/** The first message that reaches into the visible part of the history. */
function topMessageId(viewport: HTMLElement): string | null {
  const { top } = viewport.getBoundingClientRect();
  for (const element of messageElements(viewport)) {
    const messageId = element.dataset.messageId;
    if (messageId === undefined || messageId === PENDING_MESSAGE_ID) continue;
    if (element.getBoundingClientRect().bottom > top) return messageId;
  }
  return null;
}

/** Scrolls the history so the message stands at its top; the page around it stays. */
function scrollToTop(viewport: HTMLElement, target: HTMLElement): void {
  viewport.scrollTop +=
    target.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
}

/**
 * Places the history of a chat when it opens: at the message the person
 * stopped reading at, else at the foot. A message before the loaded pages is
 * reached by loading one older page after the other.
 */
function usePlacement(
  viewport: React.RefObject<HTMLElement | null>,
  state: PositionState,
  input: HistoryPositionInput,
): void {
  const { chatKey, messageIds, hasFocusRequest, older } = input;
  const { hasMore, isLoading, onLoad } = older;
  const count = messageIds.length;
  useEffect(() => {
    const element = viewport.current;
    if (!element || state.placedChat === chatKey) return;
    if (state.loadingChat !== chatKey) {
      state.loadingChat = chatKey;
      state.loadedPages = 0;
      state.requestedAt = null;
    }
    const wanted = hasFocusRequest ? undefined : state.positions.get(chatKey);
    const target = wanted === undefined ? null : findMessage(element, wanted);
    const needsOlder =
      wanted !== undefined &&
      target === null &&
      hasMore &&
      state.loadedPages < MAXIMUM_OLDER_PAGES;
    if (needsOlder) {
      if (!isLoading && state.requestedAt !== count) {
        state.requestedAt = count;
        state.loadedPages += 1;
        onLoad();
      }
      return;
    }
    state.placedChat = chatKey;
    state.isFollowing = target === null;
    if (target) scrollToTop(element, target);
    else element.scrollTop = element.scrollHeight;
  }, [
    viewport,
    state,
    chatKey,
    hasFocusRequest,
    hasMore,
    isLoading,
    onLoad,
    count,
  ]);
}

/** Stores the pending position once, when it differs from what is stored. */
function storePending(state: PositionState): void {
  const { pending } = state;
  state.pending = null;
  if (!pending) return;
  const { chatKey, messageId } = pending;
  if (state.positions.get(chatKey) === (messageId ?? undefined)) return;
  if (messageId === null) state.positions.delete(chatKey);
  else state.positions.set(chatKey, messageId);
  saveReadingPosition(chatKey, messageId);
}

/**
 * Follows where the person reads: at the foot, the history keeps following
 * new messages; elsewhere it stays, and the message at the top is stored for
 * the next visit, also when the page closes.
 */
function useTracking(
  viewport: React.RefObject<HTMLElement | null>,
  state: PositionState,
  tracked: { readonly chatKey: string; readonly hasMessages: boolean },
): void {
  const { chatKey, hasMessages } = tracked;
  useEffect(() => {
    const element = viewport.current;
    if (!element) return undefined;
    let timer = 0;
    let frame = 0;
    function record(): void {
      frame = 0;
      if (!element || state.placedChat !== chatKey) return;
      state.isFollowing = isNearFoot(element);
      state.pending = {
        chatKey,
        messageId: state.isFollowing ? null : topMessageId(element),
      };
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => storePending(state),
        SAVE_DELAY_MILLISECONDS,
      );
    }
    function handleScroll(): void {
      if (frame === 0) frame = window.requestAnimationFrame(record);
    }
    function handlePageHide(): void {
      storePending(state);
    }
    function handleVisibilityChange(): void {
      if (document.visibilityState === "hidden") storePending(state);
    }
    element.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      element.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      storePending(state);
    };
  }, [viewport, state, chatKey, hasMessages]);
}

/** Keeps the foot in view while the person reads there, and after a message of their own. */
function useFootFollow(
  viewport: React.RefObject<HTMLElement | null>,
  state: PositionState,
  foot: HistoryPositionInput["foot"],
): void {
  const { newestId, isOwn, growth } = foot;
  const followedId = useRef<string | null>(null);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    if (isOwn && followedId.current !== newestId) state.isFollowing = true;
    followedId.current = newestId;
    if (state.isFollowing) element.scrollTop = element.scrollHeight;
  }, [viewport, state, newestId, isOwn, growth]);
}

/**
 * Brings the history of the opened chat where the person stopped reading, and
 * remembers where they stop.
 * @remarks
 * A history opens at the message the person had at its top when they left,
 * or at its foot when they had read it to the end. Following the foot stops
 * once the person scrolls up, so a growing answer does not pull them away; a
 * message of their own brings them back. The position is stored shortly after
 * the scrolling stops and when the page is left, so it is there when the chat
 * opens again, also on another device. A link to a message replaces it.
 * @param viewport - The scroll area of the history.
 * @param input - The opened chat, its stored position, messages and foot.
 */
export function useHistoryPosition(
  viewport: React.RefObject<HTMLElement | null>,
  input: HistoryPositionInput,
): void {
  const holder = useRef<PositionState | null>(null);
  const state = (holder.current ??= createState(input.stored));
  usePlacement(viewport, state, input);
  useTracking(viewport, state, {
    chatKey: input.chatKey,
    hasMessages: input.messageIds.length > 0,
  });
  useFootFollow(viewport, state, input.foot);
}
