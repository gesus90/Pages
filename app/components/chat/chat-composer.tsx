import { EditorContent } from "@tiptap/react";
import { Plus, SendHorizontal } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { formatBytes } from "@/app/lib/format-bytes";

import { ChatMaintenanceStatus } from "./chat-maintenance-status";
import { ChatAttachmentList } from "./chat-attachment-list";
import { ChatJobSteerHint, ChatJobStopButton } from "./chat-job-controls";
import { useChatEditor } from "./use-chat-editor";

import styles from "./chat-composer.module.css";

import type { ChatController } from "./use-chat";

interface ChatComposerProps {
  readonly chat: ChatController;
  readonly isOpen: boolean;
}

interface ChatComposerActionsProps {
  readonly chat: ChatController;
  readonly canAttach: boolean;
  readonly canSend: boolean;
  readonly onSubmit: () => void;
}

/** The row under the input: "+", the size limit, "Stoppen" and "Abschicken" or "Abbrechen". */
function ChatComposerActions({
  chat,
  canAttach,
  canSend,
  onSubmit,
}: ChatComposerActionsProps): React.ReactElement {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const { uploads, limits, sending } = chat;

  function handleFiles(event: React.ChangeEvent<HTMLInputElement>): void {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    void uploads.attach(files);
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <Button
        aria-label={t("chat.attach")}
        disabled={!canAttach}
        onClick={() => fileInput.current?.click()}
        size="icon"
        title={t("chat.attach")}
        variant="outline"
      >
        <Plus aria-hidden="true" className="size-4" />
      </Button>
      <input
        ref={fileInput}
        className="hidden"
        multiple
        onChange={handleFiles}
        tabIndex={-1}
        type="file"
      />
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {limits
          ? t("chat.limit", { size: formatBytes(limits.limitBytes) })
          : null}
      </span>
      <ChatJobStopButton jobs={chat.jobs} />
      {sending ? (
        <Button onClick={chat.cancel} variant="outline">
          {t("chat.cancel")}
        </Button>
      ) : (
        <Button disabled={!canSend} onClick={onSubmit}>
          <SendHorizontal aria-hidden="true" className="size-4" />
          {t("chat.send")}
        </Button>
      )}
    </div>
  );
}

/**
 * The large input field with "+" for attachments and "Abschicken" (T6.12.1);
 * while an answer runs, the button cancels it instead.
 */
export function ChatComposer({
  chat,
  isOpen,
}: ChatComposerProps): React.ReactElement {
  const { t } = useTranslation();
  // Set at once, unlike the state: Enter and a click before the next render submit only once.
  const isSubmitting = useRef(false);
  const { view, uploads, sending } = chat;
  const input = useChatEditor({
    label: t("chat.input"),
    placeholder: t("chat.placeholder"),
    onSubmit: () => void handleSubmit(),
  });
  const { editor } = input;
  const isBusy =
    sending !== null ||
    view.session === null ||
    chat.isCompacting ||
    chat.commands.isDeleting;
  // A file still uploading would miss the message; it is sent once it is selected.
  const canSend =
    !isBusy &&
    uploads.uploading.length === 0 &&
    (input.markdown !== "" || view.pending.length > 0);

  useEffect(() => {
    if (isOpen) editor?.commands.focus("end");
  }, [isOpen, editor]);

  async function handleSubmit(): Promise<void> {
    const text = input.markdown;
    if (!canSend || isSubmitting.current) return;
    isSubmitting.current = true;
    input.setMarkdown("");
    try {
      if ((await chat.submit(text)) === "restore") input.setMarkdown(text);
    } finally {
      isSubmitting.current = false;
    }
  }

  return (
    <footer className="border-t border-border p-3">
      <ChatMaintenanceStatus chat={chat} />
      <ChatAttachmentList
        attachments={view.pending}
        onRemove={(id) => void uploads.discard(id)}
      />
      {uploads.uploading.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground" role="status">
          {t("chat.uploading", { count: uploads.uploading.length })}
        </p>
      ) : null}
      <div
        className={cn(
          "mt-2 rounded-xl bg-field px-3 py-2 ring-1 ring-field-border focus-within:ring-2 focus-within:ring-primary",
          styles.input,
        )}
      >
        <EditorContent editor={editor} />
      </div>
      {input.markdown.startsWith("/") ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("chat.commands")}
        </p>
      ) : null}
      <ChatJobSteerHint jobs={chat.jobs} />
      <ChatComposerActions
        chat={chat}
        canAttach={!isBusy}
        canSend={canSend}
        onSubmit={() => void handleSubmit()}
      />
    </footer>
  );
}
