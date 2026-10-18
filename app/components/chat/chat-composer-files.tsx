import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { CHAT_LIMITS } from "@/definition/Chat";

import { ChatAttachmentList } from "./chat-attachment-list";

import type { ChatController } from "./use-chat";

interface ChatComposerFilesProps {
  readonly chat: ChatController;
}

/** Files that were not taken into the selection, named, with the reason. */
function ChatUploadRejections({
  chat,
}: ChatComposerFilesProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { rejected } = chat.uploads;
  if (rejected === null) return null;
  return (
    <div
      className="mt-1.5 flex items-start gap-2 rounded-lg bg-warning-subtle px-2.5 py-1.5 text-xs text-warning"
      role="alert"
    >
      <ul className="min-w-0 flex-1 space-y-0.5">
        {rejected.map((rejection) => (
          <li key={rejection.reason} className="break-words">
            {t(`chat.files.rejected.${rejection.reason}`, {
              limit: CHAT_LIMITS.attachmentsPerMessage,
              names: rejection.names.join(", "),
            })}
          </li>
        ))}
      </ul>
      <button
        aria-label={t("chat.files.dismissRejected")}
        className="shrink-0 rounded p-0.5 hover:bg-surface focus-visible:outline-2 focus-visible:outline-primary"
        onClick={chat.uploads.clearRejected}
        type="button"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * The files of the next message above the input field (PAGE-92): how many of
 * the ten places are taken, the files that were not taken, the chosen files
 * with their upload state and why sending waits.
 */
export function ChatComposerFiles({
  chat,
}: ChatComposerFilesProps): React.ReactElement {
  const { t } = useTranslation();
  const { uploads } = chat;
  const sending = new Set(
    (chat.sending?.attachments ?? []).map(({ id }) => id),
  );
  const pending = chat.view.pending.filter(({ id }) => !sending.has(id));
  const failed = uploads.items.filter((item) => item.status === "failed");
  const taken = pending.length + uploads.uploading.length;
  return (
    <>
      {taken + failed.length > 0 ? (
        <p className="text-xs text-muted-foreground" role="status">
          {t("chat.files.count", {
            count: taken,
            limit: CHAT_LIMITS.attachmentsPerMessage,
          })}
        </p>
      ) : null}
      <ChatUploadRejections chat={chat} />
      <ChatAttachmentList
        attachments={pending}
        isCompact
        onDismiss={uploads.dismiss}
        onRemove={(id) => void uploads.discard(id)}
        onRetry={(key) => void uploads.retry(key)}
        uploads={uploads.items}
      />
      {uploads.uploading.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground" role="status">
          {t("chat.uploading", { count: uploads.uploading.length })}
        </p>
      ) : null}
      {failed.length > 0 ? (
        <p className="mt-1 text-xs text-destructive">
          {t("chat.files.resolveFailed")}
        </p>
      ) : null}
    </>
  );
}
