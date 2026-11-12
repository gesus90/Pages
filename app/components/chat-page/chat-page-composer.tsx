import { EditorContent } from "@tiptap/react";
import { SendHorizontal } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import styles from "@/app/components/chat/chat-composer.module.css";
import { useChatEditor } from "@/app/components/chat/use-chat-editor";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { readMarkdown } from "@/app/lib/editor/editor-markdown";
import { EDITOR_NODE } from "@/app/lib/editor/editor-schema";

import { ChatPageAttachMenu } from "./chat-page-attach-menu";
import { ChatPageAttachmentStrip } from "./chat-page-attachment-strip";
import { useFileDrop, usePageFileDrop } from "./chat-page-drop-zone";
import { ChatPageVoiceInput } from "./chat-page-voice-input";
import { useAttachmentUploads } from "./use-attachment-uploads";

import type { Editor } from "@tiptap/react";
import type { VirtualChatSelection } from "@/definition/VirtualChat";
import type { VoiceSending } from "./use-voice-sending";

interface ChatPageComposerProps {
  /** Hint of the empty field, for a participant or a group. */
  readonly placeholder: string;
  readonly label: string;
  /** Sends the text with the IDs of the uploaded attachments, in their order. */
  readonly onSend: (content: string, attachmentIds: readonly string[]) => void;
  /** Voice messages of a stored conversation (PAGE-277); missing for an agent's chat. */
  readonly voice?: {
    readonly sending: VoiceSending;
    readonly maximumMs: number;
  };
  /** Attachments of a stored conversation (PAGE-298); missing for an agent's chat. */
  readonly attachments?: { readonly selection: VirtualChatSelection };
}

/** A web address alone, which the chat shows as a link card. */
const WEB_ADDRESS = /^https?:\/\/\S+$/iu;

/**
 * Appends a template of the "+" menu as new blocks at the end of the message.
 *
 * @remarks
 * The blocks are inserted into the document instead of appending to the
 * Markdown text and reading all of it again, which would rewrite what the
 * person typed. A web address becomes a paragraph of plain text: read as
 * Markdown it would turn into a link and leave the editor as `<https://…>`,
 * which is no longer an address alone in its line.
 */
function appendTemplate(editor: Editor, text: string): void {
  const blocks = WEB_ADDRESS.test(text)
    ? [
        {
          type: EDITOR_NODE.paragraph,
          content: [{ type: EDITOR_NODE.text, text }],
        },
      ]
    : (readMarkdown(text, editor.schema).content.content ?? []);
  const { doc } = editor.state;
  const end = doc.content.size;
  // An untouched field holds one empty paragraph, which the template replaces.
  const isUntouched =
    doc.childCount === 1 &&
    doc.firstChild?.type.name === EDITOR_NODE.paragraph &&
    doc.firstChild.content.size === 0;
  editor
    .chain()
    .insertContentAt(isUntouched ? { from: 0, to: end } : end, blocks)
    .focus("end")
    .run();
}

/** The files of a paste; none when it carries formatted text, which the editor takes. */
function pastedFiles(event: React.ClipboardEvent): File[] {
  const clipboard = event.clipboardData;
  if (clipboard.getData("text/html") !== "") return [];
  return [...clipboard.files];
}

/**
 * The input at the foot of the chat page, with the chat editor of the Pica
 * panel, the "+" menu and "Abschicken".
 *
 * @remarks
 * The editor reads its placeholder once, so the page mounts one composer per
 * conversation. Sending hands the text to the page, which sends it. In a
 * conversation with people or of a group, the microphone and the file button
 * send a voice message (PAGE-277), and files chosen in the "+" menu, dropped
 * on the conversation or pasted are uploaded and go out with the next
 * message (PAGE-298); a message of attachments alone needs no text, and
 * nothing is sent while an upload runs. The field ends 88 px before the right
 * edge of the chat, so Pica's launcher never covers it.
 */
export function ChatPageComposer({
  placeholder,
  label,
  onSend,
  voice,
  attachments,
}: ChatPageComposerProps): React.ReactElement {
  const { t } = useTranslation();
  const canAttach = attachments !== undefined;
  const uploads = useAttachmentUploads(attachments?.selection ?? null);
  const input = useChatEditor({
    label,
    placeholder,
    onSubmit: () => handleSubmit(),
  });
  const record = useRef<(() => void) | null>(null);
  const drop = useFileDrop(canAttach ? uploads.add : null);
  const isDraggingOnPage = usePageFileDrop(canAttach ? uploads.add : null);
  const isDragging = drop.isDragging || isDraggingOnPage;
  const hasReady = uploads.items.some((item) => item.state === "ready");
  const canSend = !uploads.isUploading && (input.markdown !== "" || hasReady);

  function handleSubmit(): void {
    if (!canSend) return;
    const text = input.markdown;
    input.setMarkdown("");
    onSend(text, uploads.take());
  }

  function handlePaste(event: React.ClipboardEvent): void {
    if (!canAttach) return;
    const files = pastedFiles(event);
    if (files.length === 0) return;
    event.preventDefault();
    uploads.add(files);
  }

  function handleInsert(text: string): void {
    if (input.editor) appendTemplate(input.editor, text);
  }

  return (
    <footer
      className={cn(
        "mr-22 shrink-0 rounded-[14px] border-[1.5px] border-primary bg-surface p-3 shadow-card",
        isDragging && "ring-2 ring-primary",
      )}
      onPaste={handlePaste}
      {...drop.handlers}
    >
      {isDragging ? (
        <p className="mb-2 text-sm text-muted-foreground">
          {t("chatPage.attach.dropHint")}
        </p>
      ) : null}
      <ChatPageAttachmentStrip uploads={uploads} />
      <div className={cn("pages-editor-scroll-surface", styles.input)}>
        <EditorContent editor={input.editor} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <ChatPageAttachMenu
          canAttach={canAttach}
          onFiles={uploads.add}
          onInsert={handleInsert}
          onVoice={voice ? () => record.current?.() : undefined}
        />
        {voice ? (
          <ChatPageVoiceInput
            sending={voice.sending}
            maximumMs={voice.maximumMs}
            recordRef={record}
          />
        ) : null}
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
