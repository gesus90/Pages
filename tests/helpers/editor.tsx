import { Editor, getSchema } from "@tiptap/core";
import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";

import { BlockEditor } from "@/app/components/editor/block-editor";
import {
  createSchemaExtensions,
  HEADLESS_SCHEMA_OPTIONS,
} from "@/app/components/editor/editor-extensions";
import { EditorKeymap } from "@/app/components/editor/extensions/editor-keymap";
import { MarkdownLinkRule } from "@/app/components/editor/extensions/markdown-link-rule";
import { createI18n } from "@/app/lib/i18n";
import { readMarkdown } from "@/app/lib/editor/editor-markdown";
import { LANGUAGE } from "@/language/Language";

import type { Extensions } from "@tiptap/core";
import type { RenderResult } from "@testing-library/react";
import type {
  BlockEditorFeatures,
  BlockEditorHandle,
} from "@/app/components/editor/block-editor-types";

/**
 * Gives jsdom the geometry ProseMirror asks for. jsdom lays nothing out, so
 * every rectangle is empty; that is enough for menus and the caret.
 */
export function installEditorGeometry(): void {
  const rect = (): DOMRect => new DOMRect(10, 20, 1, 16);
  const rects = (): DOMRectList => {
    const list = [rect()];

    return Object.assign(list, {
      item: (index: number) => list[index] ?? null,
    }) as unknown as DOMRectList;
  };

  // jsdom has no clipboard events; ProseMirror creates one when it pastes.
  if (typeof globalThis.ClipboardEvent === "undefined") {
    globalThis.ClipboardEvent = class extends Event {
      public readonly clipboardData: DataTransfer | null = null;
    } as unknown as typeof ClipboardEvent;
  }

  Range.prototype.getBoundingClientRect = rect;
  Range.prototype.getClientRects = rects;
  Element.prototype.getClientRects = rects;
  document.elementFromPoint = () => null;
  // ProseMirror scrolls the caret into view; jsdom only logs that it cannot.
  window.scrollBy = () => undefined;
}

/** Options of {@link createTestEditor}. */
export interface TestEditorOptions {
  readonly extensions?: Extensions;
  readonly keymap?: Partial<{
    onLink: () => void;
    onContextMenu: () => void;
    onTextAssistant: () => void;
  }>;
}

/**
 * Creates a headless editor with the markdown schema, mounted in the
 * document. React node views stay empty without `EditorContent`, which
 * suits tests of commands and document changes.
 *
 * @param markdown - Content to load.
 * @param options - Extra extensions and keymap callbacks.
 * @returns The editor.
 */
export function createTestEditor(
  markdown: string,
  options: TestEditorOptions = {},
): Editor {
  const extensions = [
    ...createSchemaExtensions(HEADLESS_SCHEMA_OPTIONS),
    EditorKeymap.configure({
      onContextMenu: options.keymap?.onContextMenu ?? vi.fn(),
      onLink: options.keymap?.onLink ?? vi.fn(),
      onTextAssistant: options.keymap?.onTextAssistant ?? vi.fn(),
    }),
    MarkdownLinkRule,
    ...(options.extensions ?? []),
  ];
  const element = document.createElement("div");

  document.body.append(element);

  return new Editor({
    content: readMarkdown(markdown, getSchema(extensions)).content,
    element,
    enablePasteRules: false,
    extensions,
  });
}

/**
 * Types text as the browser would, through ProseMirror's text input hook,
 * so markdown shortcuts and menus react.
 *
 * @param editor - The editor.
 * @param text - Characters to type one by one.
 */
export function typeText(editor: Editor, text: string): void {
  for (const character of text) {
    const { view } = editor;
    const { from, to } = view.state.selection;
    const insert = (): ReturnType<typeof view.state.tr.insertText> =>
      view.state.tr.insertText(character, from, to);
    const isHandled = view.someProp("handleTextInput", (handler) =>
      handler(view, from, to, character, insert),
    );

    if (!isHandled) {
      view.dispatch(insert());
    }
  }
}

/** Modifier keys of {@link pressKey}; `mod` is Ctrl outside Apple devices. */
export interface KeyModifiers {
  readonly mod?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
}

/**
 * Presses a key in the editor as a real keydown event, so keymaps run with
 * their selection changes.
 *
 * @param editor - The editor.
 * @param key - Key name, such as `ArrowUp`.
 * @param modifiers - Held modifier keys.
 * @returns Whether the editor handled the key.
 */
export function pressKey(
  editor: Editor,
  key: string,
  modifiers: KeyModifiers = {},
): boolean {
  const event = new KeyboardEvent("keydown", {
    altKey: modifiers.alt ?? false,
    bubbles: true,
    cancelable: true,
    ctrlKey: modifiers.mod ?? false,
    key,
    shiftKey: modifiers.shift ?? false,
  });

  editor.view.dom.dispatchEvent(event);

  return event.defaultPrevented;
}

/** Options of {@link renderBlockEditor}. */
export interface RenderEditorOptions {
  readonly isEditable?: boolean;
  readonly features?: Partial<BlockEditorFeatures>;
  readonly onChange?: (markdown: string) => void;
  readonly fallback?: React.ReactNode;
}

/** A rendered block editor with its controls once it is ready. */
export interface RenderedEditor extends RenderResult {
  readonly handle: () => BlockEditorHandle;
  readonly onReady: ReturnType<typeof vi.fn>;
}

/**
 * Renders the block editor with German texts.
 *
 * @param markdown - Content to load.
 * @param options - Rights, features and callbacks.
 * @returns The render result and the editor controls.
 */
export function renderBlockEditor(
  markdown: string,
  options: RenderEditorOptions = {},
): RenderedEditor {
  let handle: BlockEditorHandle | null = null;
  const onReady = vi.fn((ready: BlockEditorHandle | null) => {
    handle = ready ?? handle;
  });
  const rendered = render(
    <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
      <MemoryRouter>
        <BlockEditor
          fallback={options.fallback ?? <p>fallback</p>}
          features={{ isDisplayableImage: () => true, ...options.features }}
          isEditable={options.isEditable ?? true}
          label="Text"
          markdown={markdown}
          onChange={options.onChange}
          onReady={onReady}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );

  return {
    ...rendered,
    handle: () => {
      if (!handle) {
        throw new Error("The editor is not ready.");
      }

      return handle;
    },
    onReady,
  };
}
