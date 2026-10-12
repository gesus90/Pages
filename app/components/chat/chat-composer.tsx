import { EditorContent } from "@tiptap/react";
import { Plus, SendHorizontal } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { formatBytes } from "@/app/lib/format-bytes";

import { ChatAttachmentList } from "./chat-attachment-list";
import { useChatEditor } from "./use-chat-editor";

import styles from "./chat-composer.module.css";

import type { ChatController } from "./use-chat";

interface ChatComposerProps {
  readonly chat: ChatController;
  readonly isOpen: boolean;
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
  const fileInput = useRef<HTMLInputElement>(null);
  const { view, uploads, limits, sending } = chat;
  const input = useChatEditor({
    label: t("chat.input"),
    placeholder: t("chat.placeholder"),
    onSubmit: () => void handleSubmit(),
  });
  const { editor } = input;
  const isBusy = sending !== null || view.session === null;
  const canSend = !isBusy && (input.markdown !== "" || view.pending.length > 0);

  useEffect(() => {
    if (isOpen) editor?.commands.focus("end");
  }, [isOpen, editor]);

  async function handleSubmit(): Promise<void> {
    const text = input.markdown;
    if (!canSend) return;
    input.setMarkdown("");
    if ((await chat.submit(text)) === "restore") input.setMarkdown(text);
  }

  function handleFiles(event: React.ChangeEvent<HTMLInputElement>): void {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    void uploads.attach(files);
  }

  return (
    <footer className="border-t border-border p-3">
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
      <div className="mt-2 flex items-center gap-2">
        <Button
          aria-label={t("chat.attach")}
          disabled={isBusy}
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
        {sending ? (
          <Button onClick={chat.cancel} variant="outline">
            {t("chat.cancel")}
          </Button>
        ) : (
          <Button disabled={!canSend} onClick={() => void handleSubmit()}>
            <SendHorizontal aria-hidden="true" className="size-4" />
            {t("chat.send")}
          </Button>
        )}
      </div>
    </footer>
  );
}
