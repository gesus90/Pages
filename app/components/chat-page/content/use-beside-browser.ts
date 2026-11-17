import { useChatBrowsers } from "@/app/components/chat/browser/chat-browsers-context";

import { useChatContent } from "./chat-content-context";

import type { ChatBrowsers } from "@/app/components/chat/browser/use-chat-browser";
import type { PicaBrowserView } from "@/definition/PicaBrowser";

/**
 * The browser the split view shows: the one the person opened beside the chat,
 * for as long as it is open.
 * @returns The browser, or `null` when none was opened or it ended, so the
 * split view closes with the browser.
 */
export function useBesideBrowser(): {
  readonly browser: PicaBrowserView;
  readonly controller: ChatBrowsers;
} | null {
  const { besideBrowserId } = useChatContent();
  const controller = useChatBrowsers();
  if (besideBrowserId === null || controller === null) return null;
  const browser = controller.browsers.find(
    (entry) => entry.browserId === besideBrowserId && entry.state !== "stopped",
  );
  return browser ? { browser, controller } : null;
}
