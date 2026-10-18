import { EditorContent } from "@tiptap/react";
import { Plus, SendHorizontal } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { ChatMaintenanceStatus } from "./chat-maintenance-status";
import { ChatComposerFiles } from "./chat-composer-files";
import { ChatContextIndicator } from "./chat-context-indicator";
import { ChatJobSteerHint, ChatJobStopButton } from "./chat-job-controls";
import { ChatQuotaDemoStatus } from "./chat-quota-demo";
import { useChatEditor } from "./use-chat-editor";

import styles from "./chat-composer.module.css";

import type { ChatController } from "./use-chat";

interface ChatComposerProps {
  readonly chat: ChatController;
  readonly isOpen: boolean;
}

interface ChatComposerActionsProps {
  readonly chat: ChatController;
  readonly isOpen: boolean;
  readonly canAttach: boolean;
  readonly canSend: boolean;
  readonly onSubmit: () => void;
}

/** Attachments, job controls, context occupancy and the submit or cancel action. */
function ChatComposerActions({
  chat,
  isOpen,
  canAttach,
  canSend,
  onSubmit,
}: ChatComposerActionsProps): React.ReactElement {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const { uploads, sending } = chat;

  // Abbrechen takes the place of Abschicken; the second click of a double click on Abschicken must not cancel.
  function handleCancel(event: React.MouseEvent<HTMLButtonElement>): void {
    if (event.detail > 1) return;
    chat.cancel();
  }

  function handleFiles(event: React.ChangeEvent<HTMLInputElement>): void {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    void uploads.attach(files);
  }

  return (
    <div className="relative mt-2 flex flex-wrap items-center gap-2">
      <Button
        aria-label={t("chat.attach")}
        className="shrink-0 border-2 border-primary text-primary hover:border-primary-hover hover:bg-primary-subtle hover:text-primary-hover active:border-primary-hover active:bg-primary/15 disabled:border-primary/60 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
        disabled={!canAttach}
        onClick={() => fileInput.current?.click()}
        size="icon"
        title={t("chat.attach")}
        variant="outline"
      >
        <Plus aria-hidden="true" className="size-4" />
      </Button>
      {/* Visually hidden instead of display:none, so a browser tool finds the input by its name and sets a file without the native dialog. */}
      <input
        ref={fileInput}
        aria-label={t("chat.attachInput")}
        className="sr-only"
        multiple
        onChange={handleFiles}
        tabIndex={-1}
        type="file"
      />
      <div className="ml-auto flex shrink-0 items-center gap-1 xl:gap-2">
        <ChatContextIndicator
          key={`${chat.view.session?.id ?? ""}:${isOpen}`}
          context={chat.context}
        />
        <ChatJobStopButton jobs={chat.jobs} />
        {sending && !chat.jobs.isRunning ? (
          <Button onClick={handleCancel} variant="outline">
            {t("chat.cancel")}
          </Button>
        ) : (
          <Button
            className="gap-1 px-1.5 text-sm xl:gap-1.5 xl:px-3"
            disabled={!canSend}
            onClick={onSubmit}
          >
            <SendHorizontal aria-hidden="true" className="size-4" />
            {t("chat.send")}
          </Button>
        )}
      </div>
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
  const canAttach =
    view.session !== null && !chat.isCompacting && !chat.commands.isDeleting;
  const isBusy = sending !== null || !canAttach;
  // A file still uploading would miss the message, a failed one would be left out without a word;
  // a chat command such as /sessions sends no files, so it runs while files upload.
  const isCommand = input.markdown.startsWith("/");
  const canSend =
    !isBusy &&
    (isCommand ||
      (uploads.items.length === 0 &&
        (input.markdown !== "" || view.pending.length > 0)));

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
    <footer className="p-3">
      <ChatQuotaDemoStatus demo={chat.quotaDemo} />
      <ChatMaintenanceStatus chat={chat} />
      <ChatComposerFiles chat={chat} />
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
        isOpen={isOpen}
        canAttach={canAttach}
        canSend={canSend}
        onSubmit={() => void handleSubmit()}
      />
    </footer>
  );
}
