import { Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { CHAT_LIMITS } from "@/definition/Chat";

import type { ChatController } from "./use-chat";

/**
 * The drop area over the chat while files are dragged onto it (PAGE-92); it
 * names how many of the ten places of the message are still free.
 */
export function ChatDropArea({
  chat,
}: {
  readonly chat: ChatController;
}): React.ReactElement {
  const { t } = useTranslation();
  const sending = new Set(
    (chat.sending?.attachments ?? []).map(({ id }) => id),
  );
  const taken =
    chat.view.pending.filter(({ id }) => !sending.has(id)).length +
    chat.uploads.uploading.length;
  const free = Math.max(0, CHAT_LIMITS.attachmentsPerMessage - taken);
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary bg-surface/95 p-6 text-center"
    >
      <Upload className="size-8 text-primary" />
      <p className="text-base font-semibold text-foreground">
        {t("chat.files.drop.title")}
      </p>
      <p className="text-sm text-muted-foreground">
        {free > 0
          ? t("chat.files.drop.hint", {
              count: free,
              limit: CHAT_LIMITS.attachmentsPerMessage,
            })
          : t("chat.files.drop.full", {
              limit: CHAT_LIMITS.attachmentsPerMessage,
            })}
      </p>
    </div>
  );
}
