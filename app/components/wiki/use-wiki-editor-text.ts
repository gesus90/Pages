import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { useMenuNavigation } from "@/app/components/wiki/use-menu-navigation";
import {
  applyEditorCommand,
  continueList,
  replaceEditorRange,
  WIKI_EDITOR_COMMANDS,
} from "@/app/lib/wiki-editor-commands";
import { findEditorTrigger } from "@/app/lib/wiki-editor-triggers";
import {
  describeReference,
  formatReference,
  referenceKey,
} from "@/app/lib/wiki-references";

import type {
  EditorText,
  WikiEditorCommand,
} from "@/app/lib/wiki-editor-commands";
import type { EditorTrigger } from "@/app/lib/wiki-editor-triggers";
import type { WikiReference } from "@/definition/Wiki";

/** An entry of the menu under the caret. */
export interface EditorMenuItem {
  readonly key: string;
  readonly label: string;
  readonly hint?: string;
}

/** What the editor text area needs besides its value. */
export interface WikiEditorTextState {
  readonly textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** The open menu: blocks after `/`, pages, tickets and people after `[[` or `@`. */
  readonly menu: {
    readonly kind: EditorTrigger["kind"];
    readonly items: readonly EditorMenuItem[];
  } | null;
  readonly menuIndex: number;
  readonly handleChange: (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => void;
  readonly handleKeyDown: (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => void;
  readonly handleCaretMove: () => void;
  readonly runCommand: (command: WikiEditorCommand) => void;
  readonly pickItem: (key: string) => void;
  /** Inserts text at the caret, replacing the selection. */
  readonly insertText: (text: string) => void;
}

function readText(textarea: HTMLTextAreaElement): EditorText {
  return {
    end: textarea.selectionEnd,
    start: textarea.selectionStart,
    value: textarea.value,
  };
}

function isCommand(key: string): key is WikiEditorCommand {
  return WIKI_EDITOR_COMMANDS.some((command) => command === key);
}

/**
 * Works out the text after a choice in the menu.
 *
 * @param current - Text and caret of the editor.
 * @param trigger - What opened the menu.
 * @param key - Key of the chosen entry.
 * @param found - The references the picker offered.
 * @returns The new text, or `null` when the key names nothing.
 */
function resolveChoice(
  current: EditorText,
  trigger: EditorTrigger,
  key: string,
  found: readonly WikiReference[],
): EditorText | null {
  const reference = found.find((entry) => referenceKey(entry) === key);

  if (reference) {
    return replaceEditorRange(
      current,
      trigger.from,
      trigger.to,
      formatReference(reference),
    );
  }

  return isCommand(key)
    ? applyEditorCommand(
        replaceEditorRange(current, trigger.from, trigger.to, ""),
        key,
      )
    : null;
}

function buildMenuItems(
  trigger: EditorTrigger | null,
  found: readonly WikiReference[],
  translate: (key: string) => string,
): EditorMenuItem[] | null {
  if (trigger === null) {
    return null;
  }

  if (trigger.kind === "slash") {
    return WIKI_EDITOR_COMMANDS.map((key) => ({
      key,
      label: translate(`wiki.editor.command.${key}`),
    })).filter((item) =>
      item.label.toLowerCase().includes(trigger.query.toLowerCase()),
    );
  }

  return found.map((reference) => {
    const { kind, label } = describeReference(reference);

    return {
      hint: translate(`wiki.editor.reference.${kind}`),
      key: referenceKey(reference),
      label,
    };
  });
}

/**
 * Wires the editor text area: toolbar commands, list continuation, the slash
 * menu for blocks and the picker for pages, tickets and people.
 *
 * @param content - Current text.
 * @param setContent - Stores a new text.
 * @returns Refs, menu state and handlers.
 */
export function useWikiEditorText(
  content: string,
  setContent: (content: string) => void,
): WikiEditorTextState {
  const { t } = useTranslation();
  const references = useFetcher<{ references: WikiReference[] }>();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);
  const [trigger, setTrigger] = useState<EditorTrigger | null>(null);
  const found = references.data?.references ?? [];
  const items = buildMenuItems(trigger, found, (key) => t(key));
  const navigation = useMenuNavigation(
    items?.map((item) => item.key) ?? null,
    pickItem,
    () => setTrigger(null),
  );

  useLayoutEffect(() => {
    const selection = pendingSelection.current;

    if (selection && textareaRef.current) {
      textareaRef.current.setSelectionRange(selection.start, selection.end);
      pendingSelection.current = null;
    }
  });

  function apply(result: EditorText): void {
    pendingSelection.current = { end: result.end, start: result.start };
    setContent(result.value);
    setTrigger(null);
    textareaRef.current?.focus();
  }

  function updateTrigger(textarea: HTMLTextAreaElement): void {
    const next = findEditorTrigger(textarea.value, textarea.selectionStart);

    setTrigger(next);

    if (next?.kind === "reference") {
      void references.load(
        `/wiki-api/references?q=${encodeURIComponent(next.query)}`,
      );
    }
  }

  function pickItem(key: string): void {
    const textarea = textareaRef.current;
    const result =
      textarea && trigger
        ? resolveChoice(readText(textarea), trigger, key, found)
        : null;

    if (result) {
      apply(result);
    }
  }

  return {
    handleCaretMove: () => {
      if (textareaRef.current) {
        updateTrigger(textareaRef.current);
      }
    },
    handleChange: (event) => {
      setContent(event.target.value);
      updateTrigger(event.target);
      navigation.reset();
    },
    handleKeyDown: (event) => {
      if (navigation.handleKey(event.key)) {
        event.preventDefault();

        return;
      }

      if (event.key !== "Enter") {
        return;
      }

      const continued = continueList(readText(event.currentTarget));

      if (continued) {
        event.preventDefault();
        apply(continued);
      }
    },
    insertText: (text) => {
      if (textareaRef.current) {
        const current = readText(textareaRef.current);

        apply(replaceEditorRange(current, current.start, current.end, text));
      }
    },
    menu: trigger && items ? { items, kind: trigger.kind } : null,
    menuIndex: navigation.activeIndex,
    pickItem,
    runCommand: (command) => {
      if (textareaRef.current) {
        apply(applyEditorCommand(readText(textareaRef.current), command));
      }
    },
    textareaRef,
  };
}
