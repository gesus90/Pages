import { useState } from "react";

import { ChatBrowserCollapsedRow } from "./chat-browser-collapsed-row";
import { ChatBrowserEnlarged } from "./chat-browser-enlarged";
import { ChatBrowserPreviewRow } from "./chat-browser-preview-row";

import type { ChatBrowsers } from "./use-chat-browser";
import type {
  PicaBrowserInput,
  PicaBrowserView,
} from "@/definition/PicaBrowser";

interface ChatBrowserEntryProps {
  readonly browser: PicaBrowserView;
  readonly controller: ChatBrowsers;
  /** Opens the browser beside the chat; absent where there is no split view. */
  readonly onOpenBeside?: (browserId: string) => void;
}

/**
 * One browser in its chat: the preview row, or the slim row once the person
 * folded it, with the enlarged view over the page on request.
 */
export function ChatBrowserEntry({
  browser,
  controller,
  onOpenBeside,
}: ChatBrowserEntryProps): React.ReactElement {
  const [isEnlarged, setIsEnlarged] = useState(false);
  const { browserId } = browser;
  const openBeside = onOpenBeside ? () => onOpenBeside(browserId) : undefined;

  function relay(input: PicaBrowserInput): void {
    void controller.command(browserId, { command: "input", input });
  }

  if (controller.isCollapsed(browserId))
    return (
      <li>
        <ChatBrowserCollapsedRow
          browser={browser}
          onExpand={() => controller.setCollapsed(browserId, false)}
        />
      </li>
    );
  return (
    <li>
      <ChatBrowserPreviewRow
        browser={browser}
        controller={controller}
        isWatching={!isEnlarged}
        onOpenBeside={openBeside}
        onEnlarge={() => setIsEnlarged(true)}
        onCollapse={() => controller.setCollapsed(browserId, true)}
      />
      <ChatBrowserEnlarged
        browser={browser}
        controller={controller}
        isOpen={isEnlarged}
        onOpenChange={setIsEnlarged}
        onInput={relay}
      />
    </li>
  );
}
