import { useEffect, useId, useState } from "react";

import { useChatEditor } from "@/app/components/chat/use-chat-editor";

import {
  activeMention,
  filterMentionChoices,
  mentionChoices,
} from "./mention-choices";
import { ChatMentionNode } from "./mention-node";

import type { EditorView } from "@tiptap/pm/view";
import type { ChatEditor } from "@/app/components/chat/use-chat-editor";
import type { ConversationMentionDirectory } from "@/definition/ConversationMention";
import type { MentionChoice } from "./mention-choices";

/** Editor-relative token and viewport anchor of the open picker. */
export interface MentionQuery {
  readonly from: number;
  readonly to: number;
  readonly query: string;
  readonly left: number;
  readonly bottom: number;
}

/** Composer editor plus accessible mention selection. */
export interface MentionEditor extends ChatEditor {
  readonly listId: string;
  readonly query: MentionQuery | null;
  readonly choices: readonly MentionChoice[];
  readonly selected: number;
  choose(choice: MentionChoice): void;
  select(index: number): void;
}

interface MentionEditorOptions {
  readonly label: string;
  readonly placeholder: string;
  readonly onSubmit: () => void;
  readonly directory?: ConversationMentionDirectory;
  readonly memberIds: readonly string[];
}

function readQuery(view: EditorView): MentionQuery | null {
  const { $from, empty } = view.state.selection;
  if (
    !empty ||
    $from.parent.type.spec.code ||
    $from.marks().some((mark) => mark.type.name === "code")
  )
    return null;
  const token = activeMention(
    $from.parent.textBetween(0, $from.parentOffset, "\n", "\ufffc"),
  );
  if (!token) return null;
  const from = $from.pos - token.length;
  const coordinates = view.coordsAtPos(from);
  return {
    from,
    to: $from.pos,
    query: token.query,
    left: coordinates.left,
    bottom: window.innerHeight - coordinates.top + 8,
  };
}

interface QuerySubscription {
  readonly editor: ChatEditor["editor"];
  readonly isEnabled: boolean;
  readonly setQuery: (query: MentionQuery | null) => void;
  readonly setSelected: (index: number) => void;
}

function useMentionQuery({
  editor,
  isEnabled,
  setQuery,
  setSelected,
}: QuerySubscription): void {
  useEffect(() => {
    if (!editor || !isEnabled) return undefined;
    function update(): void {
      if (!editor) return;
      setQuery(readQuery(editor.view));
      setSelected(0);
    }
    editor.on("update", update);
    editor.on("selectionUpdate", update);
    const close = (): void => setQuery(null);
    editor.on("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close);
    return () => {
      editor.off("update", update);
      editor.off("selectionUpdate", update);
      editor.off("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close);
    };
  }, [editor, isEnabled, setQuery, setSelected]);
}

interface MentionAria {
  readonly isEnabled: boolean;
  readonly query: MentionQuery | null;
  readonly current: number;
  readonly listId: string;
}

function useMentionAria(
  editor: ChatEditor["editor"],
  { isEnabled, query, current, listId }: MentionAria,
): void {
  useEffect(() => {
    if (!editor || !isEnabled) return;
    editor.view.dom.setAttribute("role", "combobox");
    editor.view.dom.setAttribute("aria-autocomplete", "list");
    editor.view.dom.setAttribute("aria-expanded", String(query !== null));
    editor.view.dom.setAttribute("aria-controls", listId);
    if (query && current >= 0)
      editor.view.dom.setAttribute(
        "aria-activedescendant",
        `${listId}-${current}`,
      );
    else editor.view.dom.removeAttribute("aria-activedescendant");
  }, [editor, isEnabled, query, current, listId]);
}

function deleteMention(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key === "Backspace" && view.state.selection.empty) {
    const { $from } = view.state.selection;
    const before = $from.nodeBefore;
    if (before?.type.name === "chatMention") {
      view.dispatch(
        view.state.tr.delete($from.pos - before.nodeSize, $from.pos),
      );
      return true;
    }
  }
  return false;
}

function insertMention(
  editor: NonNullable<ChatEditor["editor"]>,
  query: MentionQuery,
  choice: MentionChoice,
): void {
  editor
    .chain()
    .focus()
    .insertContentAt({ from: query.from, to: query.to }, [
      {
        type: "chatMention",
        attrs: { username: choice.username },
        content: [{ type: "text", text: `@${choice.username}` }],
      },
      { type: "text", text: " " },
    ])
    .run();
}

/** Shares the chat editor while intercepting menu keys before Enter can send. */
export function useMentionEditor(options: MentionEditorOptions): MentionEditor {
  const listId = useId();
  const [query, setQuery] = useState<MentionQuery | null>(null);
  const [selected, setSelected] = useState(0);
  const input = useChatEditor({
    ...options,
    extensions: [ChatMentionNode],
    onKeyDown: handleKeyDown,
  });
  const choices = options.directory
    ? filterMentionChoices(
        mentionChoices(options.directory, options.memberIds),
        query?.query ?? "",
      )
    : [];
  const { editor } = input;

  useMentionQuery({
    editor,
    isEnabled: options.directory !== undefined,
    setQuery,
    setSelected,
  });

  const firstEnabled = choices.findIndex((choice) => choice.isSelectable);
  const current = choices[selected]?.isSelectable ? selected : firstEnabled;

  useMentionAria(editor, {
    isEnabled: options.directory !== undefined,
    query,
    current,
    listId,
  });

  function choose(choice: MentionChoice): void {
    if (!query || !editor || !choice.isSelectable) return;
    insertMention(editor, query, choice);
    setQuery(null);
  }

  function handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
    if (event.isComposing) return false;
    if (deleteMention(view, event)) return true;
    if (!query) return false;
    if (event.key === "Escape" || (event.key === " " && firstEnabled < 0)) {
      setQuery(null);
      return event.key === "Escape";
    }
    if (event.key === "Enter" || event.key === "Tab") {
      if (current >= 0) choose(choices[current]);
      return true;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return false;
    const enabled = choices.flatMap((choice, index) =>
      choice.isSelectable ? [index] : [],
    );
    const offset = event.key === "ArrowDown" ? 1 : -1;
    if (enabled.length > 0)
      setSelected(
        enabled[
          (enabled.indexOf(current) + offset + enabled.length) % enabled.length
        ],
      );
    return true;
  }

  return {
    ...input,
    listId,
    query,
    choices,
    selected: current,
    choose,
    select: setSelected,
  };
}
