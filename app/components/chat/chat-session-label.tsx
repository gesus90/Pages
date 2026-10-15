import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";

import type { ChatSession } from "@/definition/Chat";

/** Identifies a session by its ID, first message and last activity. */
export function ChatSessionLabel({
  session,
  isCurrent,
}: {
  readonly session: ChatSession;
  readonly isCurrent: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  return (
    <span className="flex min-w-0 flex-col text-left">
      <span className="font-mono text-xs font-semibold">
        {session.id}
        {isCurrent ? ` · ${t("chat.sessions.current")}` : ""}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {session.preview || t("chat.sessions.empty")} ·{" "}
        {formatDateTime(session.lastMessageAt)}
      </span>
    </span>
  );
}
