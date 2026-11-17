import { createContext, use, useEffect, useState } from "react";
import { useFetcher } from "react-router";

import { CHAT_SPLIT_MINIMUM_VIEWPORT } from "@/definition/ConversationContent";

import { ChatImageViewer } from "./chat-image-viewer";

import type {
  ChatCardState,
  ConversationImage,
  ConversationLink,
} from "@/definition/ConversationContent";
import type { VirtualChatDirectory } from "@/definition/VirtualChat";
import type { OpenedCard } from "./card-types";

/** The image the viewer opens at, and the images it knows before it asks the server. */
export interface ChatImageRequest {
  readonly attachmentId: string;
  /** The images of the message that opened it, so the viewer shows at once. */
  readonly images: readonly ConversationImage[];
  /** The element that opened the viewer; it gets the focus back as a fallback. */
  readonly opener?: HTMLElement | null;
}

/** Where "Medien & Dateien" is open: next to the chat, or over the page on a narrow screen. */
export type ChatMediaPlacement = "beside" | "overlay";

/** What the content cards of one opened conversation share. */
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
  /** The browser the split view shows, by ID; it shares the frame with a card and with "Medien & Dateien". */
  readonly besideBrowserId: string | null;
  openBrowserBeside(browserId: string): void;
  closeBrowserBeside(): void;
  /** The card that covers the page: a viewer or the full screen of a card. */
  readonly overlay: OpenedCard | null;
  openOverlay(card: OpenedCard): void;
  closeOverlay(): void;
  /** The image viewer over the chat, paging through all images of the conversation. */
  readonly viewer: ChatImageRequest | null;
  openViewer(request: ChatImageRequest): void;
  closeViewer(): void;
  /** Where "Medien & Dateien" of the chat is open; `null` while closed. */
  readonly media: ChatMediaPlacement | null;
  /** Opens "Medien & Dateien" next to the chat; as full screen on a narrow screen. */
  openMedia(): void;
  closeMedia(): void;
  /**
   * Scrolls the history to a message and gives it the focus, loading older
   * pages until it is there.
   */
  revealMessage(messageId: string): void;
  /** Whether a link may be embedded here: Pages itself, a local preview or a released domain. */
  isEmbeddable(link: ConversationLink): boolean;
  /** The domains members released for this conversation. */
  readonly releasedDomains: readonly string[];
  /** Whether a domain can be released: only in a stored conversation. */
  readonly canRelease: boolean;
  /** Releases a domain for the conversation, or takes the release back. */
  setDomainReleased(domain: string, isReleased: boolean): void;
  /**
   * Writes what a preview sends with `pages.chat.send(text)` into the opened
   * conversation as a message of the person; does nothing where
   * no conversation is open.
   */
  sendFromPreview(text: string): void;
}

const NO_DOMAINS: readonly string[] = [];

const STANDALONE: ChatContent = {
  conversationId: null,
  stateOf: (...[, fallback]) => fallback,
  setState: () => undefined,
  beside: null,
  openBeside: () => undefined,
  closeBeside: () => undefined,
  besideBrowserId: null,
  openBrowserBeside: () => undefined,
  closeBrowserBeside: () => undefined,
  overlay: null,
  openOverlay: () => undefined,
  closeOverlay: () => undefined,
  viewer: null,
  openViewer: () => undefined,
  closeViewer: () => undefined,
  media: null,
  openMedia: () => undefined,
  closeMedia: () => undefined,
  revealMessage: () => undefined,
  isEmbeddable: (link) => link.embeddable,
  releasedDomains: NO_DOMAINS,
  canRelease: false,
  setDomainReleased: () => undefined,
  sendFromPreview: () => undefined,
};

const ChatContentContext = createContext<ChatContent>(STANDALONE);

/**
 * The shared state of the content cards around the caller.
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

/**
 * The split view, the overlay, the image viewer and "Medien & Dateien"; a new
 * conversation closes them. "Medien & Dateien", a card and a browser share the
 * split view, one at a time.
 */
function useOpenedCards(
  conversationKey: string,
): Pick<
  ChatContent,
  | "beside"
  | "openBeside"
  | "closeBeside"
  | "besideBrowserId"
  | "openBrowserBeside"
  | "closeBrowserBeside"
  | "overlay"
  | "openOverlay"
  | "closeOverlay"
  | "viewer"
  | "openViewer"
  | "closeViewer"
  | "media"
  | "openMedia"
  | "closeMedia"
> {
  const [beside, setBeside] = useState<OpenedCard | null>(null);
  const [besideBrowserId, setBesideBrowserId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<OpenedCard | null>(null);
  const [viewer, setViewer] = useState<ChatImageRequest | null>(null);
  const [media, setMedia] = useState<ChatMediaPlacement | null>(null);

  useEffect(() => {
    setBeside(null);
    setBesideBrowserId(null);
    setOverlay(null);
    setViewer(null);
    setMedia(null);
  }, [conversationKey]);

  function isNarrow(): boolean {
    return window.innerWidth < CHAT_SPLIT_MINIMUM_VIEWPORT;
  }

  function openBeside(card: OpenedCard): void {
    if (isNarrow()) {
      setOverlay(card);
      return;
    }
    setBeside(card);
    setBesideBrowserId(null);
    setMedia((current) => (current === "beside" ? null : current));
  }

  function openBrowserBeside(browserId: string): void {
    setBeside(null);
    setMedia((current) => (current === "beside" ? null : current));
    setBesideBrowserId(browserId);
  }

  function openMedia(): void {
    if (isNarrow()) {
      setMedia("overlay");
      return;
    }
    setBeside(null);
    setBesideBrowserId(null);
    setMedia("beside");
  }

  return {
    beside,
    openBeside,
    closeBeside: () => setBeside(null),
    besideBrowserId,
    openBrowserBeside,
    closeBrowserBeside: () => setBesideBrowserId(null),
    overlay,
    openOverlay: setOverlay,
    closeOverlay: () => setOverlay(null),
    viewer,
    openViewer: setViewer,
    closeViewer: () => setViewer(null),
    media,
    openMedia,
    closeMedia: () => setMedia(null),
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
  /** Sends the text of a preview as a message of the person. */
  readonly onPreviewSend?: (text: string) => void;
  /** Scrolls the history to a message, loading older pages. */
  readonly onRevealMessage?: (messageId: string) => void;
  readonly children: React.ReactNode;
}

/**
 * Shares the state of the content cards of the opened conversation: the
 * remembered card states, the one card of the split view, the overlay, the
 * image viewer, the domains that may be embedded and
 * the way back from a preview into the chat, and "Medien & Dateien"
 * with its way to a message.
 */
export function ChatContentProvider({
  directory,
  conversationId,
  conversationKey,
  onPreviewSend,
  onRevealMessage,
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
    sendFromPreview: onPreviewSend ?? STANDALONE.sendFromPreview,
    revealMessage: onRevealMessage ?? STANDALONE.revealMessage,
  };

  return (
    <ChatContentContext value={value}>
      {children}
      {cards.viewer ? (
        <ChatImageViewer content={value} request={cards.viewer} />
      ) : null}
    </ChatContentContext>
  );
}
