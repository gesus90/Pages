import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { useEditor } from "@tiptap/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  createSchemaExtensions,
  HEADLESS_SCHEMA_OPTIONS,
} from "@/app/components/editor/editor-extensions";
import { createMenuExtensions } from "@/app/components/editor/editor-menu-extensions";
import { insertUploads } from "@/app/components/editor/editor-uploads";
import { EditorKeymap } from "@/app/components/editor/extensions/editor-keymap";
import { MarkdownLinkRule } from "@/app/components/editor/extensions/markdown-link-rule";
import { SuggestionStore } from "@/app/components/editor/menus/suggestion-store";
import { createPlainTextSlice } from "@/app/lib/editor/editor-commands";
import {
  applyAssistantText,
  captureAssistantTarget,
} from "@/app/lib/editor/editor-assistant";
import {
  createBaseline,
  parseMarkdownSlice,
  readMarkdown,
  serializeMarkdown,
  serializeMarkdownFragment,
} from "@/app/lib/editor/editor-markdown";

import type { Editor, Extensions } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import type { TFunction } from "i18next";
import type {
  BlockEditorFeatures,
  EditorReference,
  BlockEditorHandle,
} from "@/app/components/editor/block-editor-types";
import type { BlockOption } from "@/app/components/editor/editor-block-catalog";
import type { EditorMenuStores } from "@/app/components/editor/editor-menu-extensions";
import type { MarkdownBaseline } from "@/app/lib/editor/editor-markdown";
import type { EmojiEntry } from "@/app/lib/editor/emoji-catalog";

/** What the editor reports to the component around it. */
export interface BlockEditorEvents {
  readonly onChange: (markdown: string) => void;
  readonly onLink: () => void;
  readonly onContextMenu: (editor: Editor) => void;
  readonly onTextAssistant: (editor: Editor) => void;
  /** Asks for files to upload, from the slash menu. */
  readonly onRequestFiles: () => void;
  /** Asks for the emoji picker at the caret, from the slash menu. */
  readonly onRequestEmoji: (editor: Editor) => void;
}

interface UseBlockEditorOptions {
  readonly markdown: string;
  readonly isEditable: boolean;
  readonly label: string;
  readonly features: BlockEditorFeatures;
  readonly events: BlockEditorEvents;
}

/** Reading and replacing the markdown of a mounted editor. */
export interface BlockEditorControls {
  readonly editor: Editor;
  /** The markdown of the document as it is now. */
  readonly getMarkdown: () => string;
  /** Replaces the document and the state it counts as unchanged. */
  readonly replaceMarkdown: (markdown: string) => void;
  readonly captureAssistantTarget: NonNullable<
    BlockEditorHandle["captureAssistantTarget"]
  >;
  readonly applyAssistantText: NonNullable<
    BlockEditorHandle["applyAssistantText"]
  >;
}

/** The editor with what its menus need. */
export interface BlockEditorState {
  readonly editor: Editor | null;
  readonly stores: EditorMenuStores;
  /** The controls once the editor is mounted. */
  readonly controls: BlockEditorControls | null;
}

/** Live access to the latest props from callbacks created once. */
interface LiveOptions {
  readonly features: () => BlockEditorFeatures;
  readonly events: () => BlockEditorEvents;
}

// Markdown is checked against a schema without views before the editor
// exists; the editor then loads the checked content.
const validationSchema = getSchema(
  createSchemaExtensions(HEADLESS_SCHEMA_OPTIONS),
);

function handleFiles(
  view: EditorView,
  files: readonly File[],
  features: BlockEditorFeatures,
): boolean {
  if (files.length === 0 || !features.uploadFiles) {
    return false;
  }

  void insertUploads(view, files, features.uploadFiles);

  return true;
}

/**
 * Tells whether a key press starts "paste as plain text" (`Mod+Shift+V`).
 *
 * @param event - Key event in the editor.
 * @returns Whether the next paste drops formatting.
 */
export function isPlainPasteKey(event: KeyboardEvent): boolean {
  return (
    event.shiftKey &&
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "v"
  );
}

/**
 * Pastes files as uploads and text as markdown, or as plain text after
 * `Mod+Shift+V`; HTML stays with ProseMirror.
 *
 * @param view - The editor view.
 * @param event - The paste event.
 * @param options - Features of the editor and whether formatting is dropped.
 * @returns Whether the paste was handled here.
 *
 * @remarks
 * ProseMirror opens pasted text slices as far as possible, which merges a
 * lone heading into the paragraph at the caret. Inserting the closed slice
 * with `replaceSelection` splits the block instead and keeps the structure.
 */
export function handleEditorPaste(
  view: EditorView,
  event: ClipboardEvent,
  options: {
    readonly features: BlockEditorFeatures;
    readonly isPlain: boolean;
  },
): boolean {
  const clipboard = event.clipboardData;

  if (handleFiles(view, [...(clipboard?.files ?? [])], options.features)) {
    return true;
  }

  const text = clipboard?.getData("text/plain") ?? "";
  const hasHtml = (clipboard?.getData("text/html") ?? "") !== "";

  // Plain text ignores the HTML; formatted HTML is read by ProseMirror.
  if (text === "" || (hasHtml && !options.isPlain)) {
    return false;
  }

  const { schema } = view.state;
  const slice = options.isPlain
    ? createPlainTextSlice(text, schema)
    : parseMarkdownSlice(text, schema);

  view.dispatch(
    view.state.tr
      .replaceSelection(slice)
      .scrollIntoView()
      .setMeta("uiEvent", "paste"),
  );

  return true;
}

function createExtensions(
  t: TFunction,
  live: LiveOptions,
  stores: EditorMenuStores,
): Extensions {
  return [
    ...createSchemaExtensions({
      checkboxLabel: (checked) =>
        t(checked ? "editor.task.done" : "editor.task.open"),
      isDisplayableImage: (src) => live.features().isDisplayableImage(src),
      placeholder: t("editor.placeholder"),
    }),
    EditorKeymap.configure({
      onAssistantChat: () => live.features().textAssistant?.open(),
      onContextMenu: (editor) => live.events().onContextMenu(editor),
      onLink: () => live.events().onLink(),
      onTextAssistant: (editor) => live.events().onTextAssistant(editor),
    }),
    MarkdownLinkRule,
    ...createMenuExtensions(stores, {
      features: live.features,
      labelOf: (option) => t(`editor.blocks.${option.key}`),
      requests: () => ({
        emoji: (editor) => live.events().onRequestEmoji(editor),
        files: () => live.events().onRequestFiles(),
      }),
    }),
  ];
}

function createStores(live: LiveOptions): EditorMenuStores {
  return {
    emoji: new SuggestionStore<EmojiEntry>(),
    references: new SuggestionStore<EditorReference>(),
    slash: new SuggestionStore<BlockOption>(
      (option) =>
        option.key !== "assistant" ||
        live.features().textAssistant !== undefined,
    ),
  };
}

/** The controls of a mounted editor, writing against its baseline. */
function createControls(
  editor: Editor,
  baseline: React.RefObject<MarkdownBaseline | null>,
): BlockEditorControls {
  return {
    editor,
    getMarkdown: () => serializeMarkdown(editor.state.doc, baseline.current),
    captureAssistantTarget: () =>
      captureAssistantTarget(editor, baseline.current),
    applyAssistantText: (change) =>
      applyAssistantText(editor, baseline.current, change),
    replaceMarkdown: (next) => {
      const replacement = readMarkdown(next, editor.schema);

      // A fresh state also starts a fresh history: undo must not bring back
      // a version that another saved one replaced.
      editor.view.updateState(
        EditorState.create({
          doc: editor.schema.nodeFromJSON(replacement.content),
          plugins: editor.state.plugins,
        }),
      );
      baseline.current = createBaseline(replacement, editor.state.doc);
    },
  };
}

/**
 * Creates the block editor for a markdown document.
 *
 * @returns The editor and its controls (`null` until it is mounted in the
 * browser) and the menu stores.
 *
 * @remarks
 * The editor reports the markdown after every change; blocks nobody changed
 * keep their exact text (see `serializeMarkdown`). Pasted markdown keeps its
 * structure and pasted plain text (Shift) does not. Tiptap's paste rules are
 * off, so plain text is never formatted behind the person's back.
 */
export function useBlockEditor({
  markdown,
  isEditable,
  label,
  features,
  events,
}: UseBlockEditorOptions): BlockEditorState {
  const { t } = useTranslation();
  const featuresRef = useRef(features);
  const eventsRef = useRef(events);
  const baselineRef = useRef<MarkdownBaseline | null>(null);
  const isPlainPaste = useRef(false);
  const [setup] = useState(() => {
    const live: LiveOptions = {
      events: () => eventsRef.current,
      features: () => featuresRef.current,
    };
    const stores = createStores(live);

    return {
      extensions: createExtensions(t, live, stores),
      loaded: readMarkdown(markdown, validationSchema),
      stores,
    };
  });

  useEffect(() => {
    featuresRef.current = features;
    eventsRef.current = events;
  });

  const editor = useEditor(
    {
      content: setup.loaded.content,
      editable: isEditable,
      editorProps: {
        attributes: {
          "aria-label": label,
          "aria-multiline": "true",
          class: "pages-editor pages-selectable",
          role: "textbox",
        },
        // Pasted text is inserted by `handleEditorPaste`; this reads text that
        // is dropped into the document.
        clipboardTextParser: (text, context) =>
          parseMarkdownSlice(text, context.doc.type.schema),
        clipboardTextSerializer: (slice) =>
          serializeMarkdownFragment(slice.content),
        handleDrop: (view, event, _, moved) =>
          !moved &&
          handleFiles(
            view,
            [...(event.dataTransfer?.files ?? [])],
            featuresRef.current,
          ),
        handleKeyDown: (_, event) => {
          isPlainPaste.current = isPlainPasteKey(event);

          return false;
        },
        handlePaste: (view, event) =>
          handleEditorPaste(view, event, {
            features: featuresRef.current,
            isPlain: isPlainPaste.current,
          }),
      },
      enablePasteRules: false,
      extensions: setup.extensions,
      immediatelyRender: false,
      onCreate: ({ editor: created }) => {
        baselineRef.current = createBaseline(setup.loaded, created.state.doc);
      },
      onUpdate: ({ editor: changed }) => {
        eventsRef.current.onChange(
          serializeMarkdown(changed.state.doc, baselineRef.current),
        );
      },
    },
    [],
  );

  useEffect(() => {
    editor?.setEditable(isEditable, false);
  }, [editor, isEditable]);

  // One set of controls per editor, so the component above can hand them
  // out once.
  const controls = useMemo(
    () => (editor ? createControls(editor, baselineRef) : null),
    [editor],
  );

  return {
    controls,
    editor,
    stores: setup.stores,
  };
}
