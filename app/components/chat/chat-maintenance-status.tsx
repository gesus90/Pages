import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { ChatController } from "./use-chat";

/** Keeps context progress visible during compaction and offers recovery after a deleted session. */
export function ChatMaintenanceStatus({
  chat,
}: {
  readonly chat: ChatController;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      {chat.isCompacting ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("chat.notice.compacting")}
        </p>
      ) : null}
      {chat.view.session === null && !chat.isLoading ? (
        <Button
          onClick={() => void chat.commands.run("/new")}
          variant="outline"
        >
          {t("chat.recover")}
        </Button>
      ) : null}
    </>
  );
}
