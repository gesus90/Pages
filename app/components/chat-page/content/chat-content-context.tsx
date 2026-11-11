import { createContext, use, useEffect, useState } from "react";
import { useFetcher } from "react-router";

import { CHAT_SPLIT_MINIMUM_VIEWPORT } from "@/definition/ConversationContent";

import type {
  ChatCardState,
  ConversationLink,
} from "@/definition/ConversationContent";
import type { VirtualChatDirectory } from "@/definition/VirtualChat";
import type { OpenedCard } from "./card-types";

/** What the content cards of one opened conversation share (PAGE-298). */
export interface ChatContent {
  /** The stored conversation; `null` for an agent's chat session or before the first message. */
  readonly conversationId: string | null;
  /** The state the person last chose for a card, or its default. */
  stateOf(cardKey: string, fallback: ChatCardState): ChatCardState;
  /** Collapses or expands a card and remembers it for the person. */
  setState(cardKey: string, state: ChatCardState): void;
  /** The card the split view shows; only one at a time. */
  readonly beside: OpenedCard | null;
  /** Opens a card next to the chat; as full screen on a narrow screen. */
  openBeside(card: OpenedCard): void;
  closeBeside(): void;
  /** The card that covers the page: a viewer or the full screen of a card. */
  readonly overlay: OpenedCard | null;
  openOverlay(card: OpenedCard): void;
  closeOverlay(): void;
  /** Whether a link may be embedded here: Pages itself, a local preview or a released domain. */
  isEmbeddable(link: ConversationLink): boolean;
  /** The domains members released for this conversation. */
  readonly releasedDomains: readonly string[];
  /** Whether a domain can be released: only in a stored conversation. */
  readonly canRelease: boolean;
  /** Releases a domain for the conversation, or takes the release back. */
  setDomainReleased(domain: string, isReleased: boolean): void;
}

const NO_DOMAINS: readonly string[] = [];

const STANDALONE: ChatContent = {
  conversationId: null,
  stateOf: (...[, fallback]) => fallback,
  setState: () => undefined,
  beside: null,
  openBeside: () => undefined,
  closeBeside: () => undefined,
  overlay: null,
  openOverlay: () => undefined,
  closeOverlay: () => undefined,
  isEmbeddable: (link) => link.embeddable,
  releasedDomains: NO_DOMAINS,
  canRelease: false,
  setDomainReleased: () => undefined,
};

const ChatContentContext = createContext<ChatContent>(STANDALONE);

/**
 * The shared state of the content cards around the caller.
 *
 * @returns The state of the surrounding {@link ChatContentProvider}; without
 * one, cards keep their defaults and open nothing, so they also render in a
 * place without split view such as the Pica panel.
 */
export function useChatContent(): ChatContent {
  return use(ChatContentContext);
}

function isOwnOrigin(url: string): boolean {
  try {
    return new URL(url).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** The card states of the person: the stored ones, changed ones at once. */
function useCardStates(
  stored: Readonly<Record<string, ChatCardState>>,
): Pick<ChatContent, "stateOf" | "setState"> {
  const saver = useFetcher();
  const [changed, setChanged] = useState<Record<string, ChatCardState>>({});

  function setState(cardKey: string, state: ChatCardState): void {
    setChanged((current) => ({ ...current, [cardKey]: state }));
    // A message on its way has no stored key yet.
    if (cardKey.startsWith("pending")) return;
    const formData = new FormData();
    formData.set("intent", "card-state");
    formData.set("cardKey", cardKey);
    formData.set("state", state);
    void saver.submit(formData, { method: "post" });
  }

  return {
    stateOf: (cardKey, fallback) =>
      changed[cardKey] ?? stored[cardKey] ?? fallback,
    setState,
  };
}

/** The split view and the overlay; a new conversation closes both. */
function useOpenedCards(
  conversationKey: string,
): Pick<
  ChatContent,
  | "beside"
  | "openBeside"
  | "closeBeside"
  | "overlay"
  | "openOverlay"
  | "closeOverlay"
> {
  const [beside, setBeside] = useState<OpenedCard | null>(null);
  const [overlay, setOverlay] = useState<OpenedCard | null>(null);

  useEffect(() => {
    setBeside(null);
    setOverlay(null);
  }, [conversationKey]);

  function openBeside(card: OpenedCard): void {
    if (window.innerWidth < CHAT_SPLIT_MINIMUM_VIEWPORT) setOverlay(card);
    else setBeside(card);
  }

  return {
    beside,
    openBeside,
    closeBeside: () => setBeside(null),
    overlay,
    openOverlay: setOverlay,
    closeOverlay: () => setOverlay(null),
  };
}

interface ChatContentProviderProps {
  readonly directory: Pick<
    VirtualChatDirectory,
    "embedDomains" | "viewPreferences"
  >;
  /** The stored conversation of the opened entry, or `null`. */
  readonly conversationId: string | null;
  /** Changes with the opened entry; the split view closes with it. */
  readonly conversationKey: string;
  readonly children: React.ReactNode;
}

/**
 * Shares the state of the content cards of the opened conversation: the
 * remembered card states, the one card of the split view, the overlay and
 * the domains that may be embedded (PAGE-298).
 */
export function ChatContentProvider({
  directory,
  conversationId,
  conversationKey,
  children,
}: ChatContentProviderProps): React.ReactElement {
  const states = useCardStates(directory.viewPreferences?.cardStates ?? {});
  const cards = useOpenedCards(conversationKey);
  const releaser = useFetcher();
  const released =
    conversationId === null
      ? NO_DOMAINS
      : (directory.embedDomains?.byConversation[conversationId] ?? NO_DOMAINS);
  const global = directory.embedDomains?.global ?? NO_DOMAINS;

  const value: ChatContent = {
    conversationId,
    ...states,
    ...cards,
    isEmbeddable: (link) =>
      link.embeddable ||
      isOwnOrigin(link.url) ||
      released.includes(link.domain) ||
      global.includes(link.domain),
    releasedDomains: released,
    canRelease: conversationId !== null,
    setDomainReleased: (domain, isReleased) => {
      if (conversationId === null) return;
      const formData = new FormData();
      formData.set("intent", "embed-domain");
      formData.set("conversationId", conversationId);
      formData.set("domain", domain);
      formData.set("isReleased", String(isReleased));
      void releaser.submit(formData, { method: "post" });
    },
  };

  return <ChatContentContext value={value}>{children}</ChatContentContext>;
}
