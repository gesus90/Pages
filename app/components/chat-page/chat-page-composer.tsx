import { EditorContent } from "@tiptap/react";
import { SendHorizontal } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import styles from "@/app/components/chat/chat-composer.module.css";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";
import { readMarkdown } from "@/app/lib/editor/editor-markdown";
import { EDITOR_NODE } from "@/app/lib/editor/editor-schema";

import { MentionPicker } from "./mentions/mention-picker";
import { useMentionEditor } from "./mentions/use-mention-editor";
import { useMentionDirectory } from "./mentions/mention-context";

import { ChatPageAttachMenu } from "./chat-page-attach-menu";
import { ChatPageAttachmentStrip } from "./chat-page-attachment-strip";
import { useFileDrop, usePageFileDrop } from "./chat-page-drop-zone";
import { ChatPageVoiceInput } from "./chat-page-voice-input";
import { ChatPageActivityRow } from "./live/chat-page-activity-row";
import { ChatPageSteerControls } from "./live/chat-page-steer-controls";
import { useAttachmentUploads } from "./use-attachment-uploads";

import type { Editor } from "@tiptap/react";
import type { ConversationDelivery } from "@/definition/ConversationLiveAnswer";
import type { AgentActivity } from "./live/chat-page-activity-row";
import type { ComposerAttachments, ComposerVoice } from "./chat-page-input";

/** What the input offers while agents answer. */
export interface ComposerAnswering {
  /** Who answers, for the labels, such as "Ed" or "Ed, Mei". */
  readonly name: string;
  /** Stops the running answers (Esc, "Anhalten"). */
  readonly onStop: () => void;
  /**
   * A group: Enter and the main button send as usual, and steering is the
   * deliberate choice "Umlenken" of the menu. In a direct chat Enter steers.
   */
  readonly isGroup?: boolean;
}

interface ChatPageComposerProps {
  /** Hint of the empty field, for a participant or a group. */
  readonly placeholder: string;
  readonly memberIds?: readonly string[];
  readonly label: string;
  /**
   * Sends the text with the IDs of the uploaded attachments, in their order;
   * while agents answer with how it goes to them.
   */
  readonly onSend: (
    content: string,
    attachmentIds: readonly string[],
    delivery?: ConversationDelivery,
  ) => void;
  /**
   * Present while agents answer: Enter steers in a direct chat and sends as
   * usual in a group, ⌥↵ sends afterwards, Esc stops.
   */
  readonly answering?: ComposerAnswering;
  /** The agents at work in the chat and what they do, above the field. */
  readonly activity?: readonly AgentActivity[];
  /** Voice messages; missing where nothing can be recorded. */
  readonly voice?: ComposerVoice;
  /** Attachments; missing where no file can be attached. */
  readonly attachments?: ComposerAttachments;
  /** Receives what puts `@username ` into the field, for the menu of an agent in the chat head. */
  readonly mentionRef?: React.RefObject<((username: string) => void) | null>;
}

/** A web address alone, which the chat shows as a link card. */
const WEB_ADDRESS = /^https?:\/\/\S+$/iu;

/**
 * Appends a template of the "+" menu as new blocks at the end of the message.
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

/**
 * Puts `@username ` at the end of the message and focuses the field.
 * @remarks
 * The mention goes where the person writes on: a space separates it from
 * text already there, and the field keeps the one that follows it.
 */
function appendMention(editor: Editor, username: string): void {
  const text = editor.state.doc.textContent;
  const separator = text === "" || /\s$/u.test(text) ? "" : " ";
  editor.chain().focus("end").insertContent(`${separator}@${username} `).run();
}

/** The files of a paste; none when it carries formatted text, which the editor takes. */
function pastedFiles(event: React.ClipboardEvent): File[] {
  const clipboard = event.clipboardData;
  if (clipboard.getData("text/html") !== "") return [];
  return [...clipboard.files];
}

/** What the person chose to do with the message: send it, steer with it, or send it afterwards. */
type ComposerSendAction = "send" | "steer" | "after";

/**
 * How the message goes to the answering agents. In a group an ordinary send
 * carries no delivery, so the server routes it as any message; only a
 * deliberate choice steers or waits.
 */
function answeringSendDelivery(
  answering: ComposerAnswering | undefined,
  action: ComposerSendAction,
): ConversationDelivery | undefined {
  if (!answering) return undefined;
  if (action === "after") return "after";
  if (action === "send" && answering.isGroup === true) return undefined;
  return "steer";
}

interface ComposerFooterActionsProps {
  readonly canAttach: boolean;
  readonly uploads: ReturnType<typeof useAttachmentUploads>;
  readonly onInsert: (text: string) => void;
  readonly voice: ChatPageComposerProps["voice"];
  readonly recordRef: React.RefObject<(() => void) | null>;
  readonly answering: ComposerAnswering | undefined;
  readonly canSend: boolean;
  readonly onSubmit: (action: ComposerSendAction) => void;
}

/**
 * The foot of the input: "+" and the microphone at the left, at the right
 * the buttons in an area of a fixed 248 px.
 * @remarks
 * The area holds "Senden" or, while agents answer, stop, the main button and
 * the arrow: "Umlenken ↵" in a direct chat, "Senden ↵" in a group; its width
 * never changes. The context rings of the agents stand
 * in the chat head, next to the state of each agent, not here.
 */
function ComposerFooterActions({
  canAttach,
  uploads,
  onInsert,
  voice,
  recordRef,
  answering,
  canSend,
  onSubmit,
}: ComposerFooterActionsProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-2"
      data-composer-footer=""
    >
      <ChatPageAttachMenu
        canAttach={canAttach}
        onFiles={uploads.add}
        onInsert={onInsert}
        onVoice={voice ? () => recordRef.current?.() : undefined}
      />
      {voice ? (
        <ChatPageVoiceInput
          sending={voice.sending}
          maximumMs={voice.maximumMs}
          recordRef={recordRef}
        />
      ) : null}
      <div
        className="ml-auto flex max-w-full min-w-0 items-center gap-2"
        data-composer-end=""
      >
        <div
          className="flex w-[248px] max-w-full shrink-0 items-center justify-end"
          data-composer-actions=""
        >
          {answering ? (
            <ChatPageSteerControls
              name={answering.name}
              canSend={canSend}
              isGroup={answering.isGroup === true}
              onSend={() => onSubmit("send")}
              onSteer={() => onSubmit("steer")}
              onAfter={() => onSubmit("after")}
              onStop={answering.onStop}
            />
          ) : (
            <Button
              className="h-11 gap-1 px-1.5 text-sm xl:h-9 xl:gap-1.5 xl:px-3"
              disabled={!canSend}
              onClick={() => onSubmit("send")}
            >
              <SendHorizontal aria-hidden="true" className="size-4" />
              {t("chatPage.send")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

interface ComposerBindingsOptions {
  readonly canAttach: boolean;
  readonly answering: ComposerAnswering | undefined;
  readonly input: ReturnType<typeof useMentionEditor>;
  readonly uploads: ReturnType<typeof useAttachmentUploads>;
  readonly mentionRef?: React.RefObject<((username: string) => void) | null>;
  readonly onSubmitAfter: () => void;
}

function useComposerBindings({
  canAttach,
  answering,
  input,
  uploads,
  mentionRef,
  onSubmitAfter,
}: ComposerBindingsOptions): {
  readonly handleKeyDownCapture: (event: React.KeyboardEvent) => void;
  readonly handlePaste: (event: React.ClipboardEvent) => void;
} {
  useEffect(() => {
    if (!mentionRef) return undefined;
    mentionRef.current = (username) => {
      if (input.editor) appendMention(input.editor, username);
    };
    return () => {
      mentionRef.current = null;
    };
  }, [mentionRef, input.editor]);

  // ⌥↵ sends after the running answer and Esc stops it, unless the mention list is open.
  function handleKeyDownCapture(event: React.KeyboardEvent): void {
    if (!answering || input.query !== null) return;
    if (event.key === "Enter" && event.altKey && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      onSubmitAfter();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      answering.onStop();
    }
  }

  function handlePaste(event: React.ClipboardEvent): void {
    if (!canAttach) return;
    const files = pastedFiles(event);
    if (files.length === 0) return;
    event.preventDefault();
    uploads.add(files);
  }

  return { handleKeyDownCapture, handlePaste };
}

/**
 * The input at the foot of the chat page, with the chat editor of the Pica
 * panel, the "+" menu and "Abschicken".
 *
 * @remarks
 * The editor reads its placeholder once, so the page mounts one composer per
 * conversation. Sending hands the text to the page, which sends it. In every
 * chat, with people, with agents or of a group, the microphone and the file
 * button send a voice message, and files chosen in the "+" menu,
 * dropped on the chat or pasted are uploaded and go out with the next
 * message; a message of attachments alone needs no text, and
 * nothing is sent while an upload runs. The menu of an agent in the chat head
 * puts its mention into the field through `mentionRef`. The field
 * ends 88 px before the right edge of the chat, so Pica's launcher never
 * covers it.
 */
export function ChatPageComposer({
  placeholder,
  label,
  onSend,
  voice,
  attachments,
  mentionRef,
  answering,
  activity = [],
  memberIds = [],
}: ChatPageComposerProps): React.ReactElement {
  const { t } = useTranslation();
  const canAttach = attachments !== undefined;
  const uploads = useAttachmentUploads(attachments?.selection ?? null, {
    isAgentChat: attachments?.isAgentChat === true,
  });
  const directory = useMentionDirectory();
  const input = useMentionEditor({
    directory,
    memberIds,
    label,
    placeholder,
    onSubmit: () => handleSubmit("send"),
  });
  const record = useRef<(() => void) | null>(null);
  const onAddFiles = canAttach ? uploads.add : null;
  const drop = useFileDrop(onAddFiles);
  const isDraggingOnPage = usePageFileDrop(onAddFiles);
  const isDragging = drop.isDragging || isDraggingOnPage;
  const hasReady = uploads.items.some((item) => item.state === "ready");
  const canSend = !uploads.isUploading && (input.markdown !== "" || hasReady);

  function handleSubmit(action: ComposerSendAction = "send"): void {
    if (!canSend) return;
    const text = input.markdown;
    input.setMarkdown("");
    onSend(text, uploads.take(), answeringSendDelivery(answering, action));
  }

  const { handleKeyDownCapture, handlePaste } = useComposerBindings({
    canAttach,
    answering,
    input,
    uploads,
    mentionRef,
    onSubmitAfter: () => handleSubmit("after"),
  });

  return (
    <footer
      data-chat-composer=""
      className={cn(
        "mr-22 shrink-0 rounded-[14px] border-[1.5px] border-primary bg-surface p-3 shadow-card",
        isDragging && "ring-2 ring-primary",
      )}
      onPaste={handlePaste}
      onKeyDownCapture={handleKeyDownCapture}
      {...drop.handlers}
    >
      <ChatPageActivityRow entries={activity} />
      {isDragging ? (
        <p className="mb-2 text-sm text-muted-foreground">
          {t("chatPage.attach.dropHint")}
        </p>
      ) : null}
      <MentionPicker input={input} />
      <ChatPageAttachmentStrip uploads={uploads} />
      <div className={cn("pages-editor-scroll-surface", styles.input)}>
        <EditorContent editor={input.editor} />
      </div>
      <ComposerFooterActions
        answering={answering}
        canAttach={canAttach}
        canSend={canSend}
        onInsert={(text) => {
          if (input.editor) appendTemplate(input.editor, text);
        }}
        onSubmit={handleSubmit}
        recordRef={record}
        uploads={uploads}
        voice={voice}
      />
    </footer>
  );
}
