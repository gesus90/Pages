import { useTranslation } from "react-i18next";

import type { ChatDecisionStatus } from "@/definition/ConversationDecision";
import type { VirtualChatMessage } from "@/definition/VirtualChat";
import type { OpenedConversation } from "../use-chat-page";

/** Public health and the last fallback, without exposing the chosen connection. */
export function ChatDecisionHealth({
  status,
  opened,
  messages,
}: {
  readonly status: ChatDecisionStatus | undefined;
  readonly opened: OpenedConversation | null;
  readonly messages: readonly VirtualChatMessage[];
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (opened?.kind !== "group" || status === undefined) return null;
  const last = [...messages]
    .reverse()
    .find((message) => message.decision)?.decision;
  const isDecision =
    !opened.group.replyMode || opened.group.replyMode === "decision";
  const hasFallback =
    isDecision && last !== undefined && last.fallback !== "none";
  return (
    <p
      role="status"
      className="text-xs text-muted-foreground"
      data-chat-decision-status={status}
    >
      {opened.group.replyMode && opened.group.replyMode !== "decision"
        ? t(`chatPage.replySettings.modes.${opened.group.replyMode}.label`)
        : t(`chatPage.decisionHealth.${status}`)}
      {hasFallback
        ? ` · ${t(`chatPage.replySettings.decisions.result.unavailable.${last.fallback}`)}`
        : ""}
    </p>
  );
}
