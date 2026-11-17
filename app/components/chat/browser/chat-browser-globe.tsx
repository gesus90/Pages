import { Globe } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { browsersOfChat, globeStateOf } from "./chat-browser-chat";
import { useChatBrowsers } from "./chat-browsers-context";

import type { OpenBrowserState } from "./chat-browser-chat";

const GLOBE_COLORS: Readonly<Record<OpenBrowserState, string>> = {
  running: "text-success",
  paused: "text-warning",
  takeover: "text-info",
};

/**
 * The globe in a chat's list entry while a browser is open in that chat, in
 * the color of its state, whether or not the chat is the open one.
 * @param chatSessionIds - The chat sessions of the entry's chat.
 */
export function ChatBrowserGlobe({
  chatSessionIds,
}: {
  readonly chatSessionIds: readonly string[];
}): React.ReactElement | null {
  const { t } = useTranslation();
  const controller = useChatBrowsers();
  if (!controller) return null;
  const state = globeStateOf(
    browsersOfChat(controller.browsers, chatSessionIds),
  );
  if (state === null) return null;
  return (
    <Globe
      role="img"
      aria-label={t("chat.browser.listHint", {
        state: t(`chat.browser.state.${state}`),
      })}
      className={cn("size-4 shrink-0", GLOBE_COLORS[state])}
    />
  );
}
