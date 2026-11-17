import type {
  PicaBrowserState,
  PicaBrowserView,
} from "@/definition/PicaBrowser";

/** The state of a browser that is still open. */
export type OpenBrowserState = Exclude<PicaBrowserState, "stopped">;

/** The states a globe in the chat list can show, the one that needs the person most first. */
const GLOBE_STATE_ORDER: readonly OpenBrowserState[] = [
  "takeover",
  "paused",
  "running",
];

/**
 * The browsers a chat shows: those opened in one of its chat sessions that are
 * still open.
 * @param browsers - Every browser the administrator can see.
 * @param chatSessionIds - The chat sessions of the chat: the session of an agent
 * in a direct chat, the sessions of the agents of a group, or the session of Pica.
 * @returns The matching browsers; a browser without a chat session matches no chat.
 */
export function browsersOfChat(
  browsers: readonly PicaBrowserView[],
  chatSessionIds: readonly string[],
): readonly PicaBrowserView[] {
  return browsers.filter(
    (browser) =>
      browser.state !== "stopped" &&
      browser.chatSessionId !== undefined &&
      chatSessionIds.includes(browser.chatSessionId),
  );
}

/**
 * The state the globe of a chat shows when the chat holds several browsers.
 * @param browsers - The open browsers of the chat.
 * @returns The state that needs the person most, or `null` without a browser.
 */
export function globeStateOf(
  browsers: readonly PicaBrowserView[],
): OpenBrowserState | null {
  return (
    GLOBE_STATE_ORDER.find((state) =>
      browsers.some((browser) => browser.state === state),
    ) ?? null
  );
}

/** The seconds of a running time as "1 min 41 s", or "1 h 5 min" from an hour on. */
export function formatBrowserElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes === 0) return `${totalSeconds} s`;
  if (minutes < 60) return `${minutes} min ${totalSeconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
