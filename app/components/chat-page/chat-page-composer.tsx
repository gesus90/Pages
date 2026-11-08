import { EditorContent } from "@tiptap/react";
import { Plus, SendHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

import styles from "@/app/components/chat/chat-composer.module.css";
import { useChatEditor } from "@/app/components/chat/use-chat-editor";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

interface ChatPageComposerProps {
  /** Hint of the empty field, for a participant or a group. */
  readonly placeholder: string;
  readonly label: string;
  readonly onSend: (content: string) => void;
}

/**
 * The input at the foot of the chat page, with the chat editor of the Pica
 * panel, a square "+" and "Abschicken".
 *
 * @remarks
 * The editor reads its placeholder once, so the page mounts one composer per
 * conversation. Sending appends the message to the local history only; "+"
 * gets its function with attachments in a later ticket.
 */
export function ChatPageComposer({
  placeholder,
  label,
  onSend,
}: ChatPageComposerProps): React.ReactElement {
  const { t } = useTranslation();
  const input = useChatEditor({
    label,
    placeholder,
    onSubmit: () => handleSubmit(),
  });
  const canSend = input.markdown !== "";

  function handleSubmit(): void {
    const text = input.markdown;
    if (text === "") return;
    input.setMarkdown("");
    onSend(text);
  }

  return (
    <footer className="shrink-0 rounded-[14px] border-[1.5px] border-primary bg-surface p-3 shadow-card">
      <div className={cn("pages-editor-scroll-surface", styles.input)}>
        <EditorContent editor={input.editor} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button
          aria-disabled="true"
          aria-label={t("chatPage.attach")}
          className="size-9 min-h-9 shrink-0 rounded-[10px] p-0 xl:min-h-9 xl:p-0"
          title={t("chatPage.comingSoon")}
        >
          <Plus aria-hidden="true" className="size-4" />
        </Button>
        <Button
          className="ml-auto h-11 gap-1 px-1.5 text-sm xl:h-9 xl:gap-1.5 xl:px-3"
          disabled={!canSend}
          onClick={handleSubmit}
        >
          <SendHorizontal aria-hidden="true" className="size-4" />
          {t("chatPage.send")}
        </Button>
      </div>
    </footer>
  );
}
