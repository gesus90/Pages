import {
  BLOCK_OPTIONS,
  filterBlockOptions,
} from "@/app/components/editor/editor-block-catalog";
import { createSuggestionExtension } from "@/app/components/editor/menus/suggestion-extension";
import { insertBlock } from "@/app/lib/editor/editor-commands";
import { EDITOR_MARK } from "@/app/lib/editor/editor-schema";
import { searchEmoji } from "@/app/lib/editor/emoji-catalog";

import type { Editor, Extensions, Range } from "@tiptap/core";
import type {
  BlockEditorFeatures,
  EditorReference,
} from "@/app/components/editor/block-editor-types";
import type { BlockOption } from "@/app/components/editor/editor-block-catalog";
import type { SuggestionStore } from "@/app/components/editor/menus/suggestion-store";
import type { EmojiEntry } from "@/app/lib/editor/emoji-catalog";

/** The stores of the three menus that typing opens. */
export interface EditorMenuStores {
  readonly slash: SuggestionStore<BlockOption>;
  readonly references: SuggestionStore<EditorReference>;
  readonly emoji: SuggestionStore<EmojiEntry>;
}

/** Requests of the slash menu that the editor component fulfils. */
export interface EditorMenuRequests {
  /** Opens the file chooser for an upload. */
  readonly files: () => void;
  /** Opens the emoji picker at the caret. */
  readonly emoji: (editor: Editor) => void;
}

/** Live access to what may change after the editor was created. */
export interface EditorMenuContext {
  readonly features: () => BlockEditorFeatures;
  readonly requests: () => EditorMenuRequests;
  readonly labelOf: (option: BlockOption) => string;
}

/**
 * Tells whether the slash menu offers an entry in this editor.
 *
 * @param option - An entry of the slash menu.
 * @param features - What the application lets the editor do.
 * @returns Whether the entry is offered; uploads and subpages need their
 * feature, the text assistant is always listed (as unavailable without it).
 */
export function isBlockOptionAvailable(
  option: BlockOption,
  features: BlockEditorFeatures,
): boolean {
  if (option.key === "file") {
    return features.uploadFiles !== undefined;
  }

  return option.key !== "page" || features.createPage !== undefined;
}

/**
 * Inserts a link to a page that was just created, as Notion does after
 * `/page`.
 *
 * @param editor - The editor.
 * @param features - What the application lets the editor do.
 * @returns Whether a link was inserted.
 */
export async function insertCreatedPage(
  editor: Editor,
  features: BlockEditorFeatures,
): Promise<boolean> {
  try {
    const page = await features.createPage?.();

    if (!page || editor.isDestroyed) {
      return false;
    }

    return editor
      .chain()
      .focus()
      .insertContent({
        content: [
          {
            marks: [{ attrs: { href: page.href }, type: EDITOR_MARK.link }],
            text: page.icon ? `${page.icon} ${page.title}` : page.title,
            type: "text",
          },
        ],
        type: "paragraph",
      })
      .run();
  } catch (error: unknown) {
    console.error("The editor could not create the page.", error);

    return false;
  }
}

/**
 * Carries out an entry of the slash menu in place of the typed command.
 *
 * @param editor - The editor.
 * @param range - The typed `/command`.
 * @param option - The chosen entry.
 * @param context - Features and requests of the editor component.
 */
export function applyBlockOption(
  editor: Editor,
  range: Range,
  option: BlockOption,
  context: Pick<EditorMenuContext, "features" | "requests">,
): void {
  editor.chain().focus().deleteRange(range).run();

  if (option.key === "file") {
    context.requests().files();
  } else if (option.key === "emoji") {
    context.requests().emoji(editor);
  } else if (option.key === "assistant") {
    context.features().textAssistant?.open();
  } else if (option.key === "page") {
    void insertCreatedPage(editor, context.features());
  } else {
    insertBlock(editor, option.key);
  }
}

/**
 * Inserts a chosen page, ticket or person in place of the typed trigger.
 *
 * @param editor - The editor.
 * @param range - The typed `[[query` or `@query`.
 * @param reference - The chosen entry.
 */
export function applyReference(
  editor: Editor,
  range: Range,
  reference: EditorReference,
): void {
  const { insertion } = reference;
  const chain = editor.chain().focus().deleteRange(range);

  if (insertion.kind === "text") {
    chain.insertContent(insertion.text).run();

    return;
  }

  chain
    .insertContent([
      {
        marks: [{ attrs: { href: insertion.href }, type: EDITOR_MARK.link }],
        text: insertion.text,
        type: "text",
      },
      { text: " ", type: "text" },
    ])
    .run();
}

/**
 * Creates the extensions of the menus that typing opens: `/` for blocks,
 * `[[` and `@` for references, `:` for emoji.
 *
 * @param stores - The stores the menus render from.
 * @param context - Live features, requests and labels of the editor.
 * @returns The extensions.
 */
export function createMenuExtensions(
  stores: EditorMenuStores,
  context: EditorMenuContext,
): Extensions {
  return [
    createSuggestionExtension<BlockOption>({
      allowedPrefixes: [" ", " "],
      apply: (editor, range, option) =>
        applyBlockOption(editor, range, option, context),
      char: "/",
      items: (query) =>
        filterBlockOptions(
          BLOCK_OPTIONS.filter((option) =>
            isBlockOptionAvailable(option, context.features()),
          ),
          query,
          context.labelOf,
        ),
      name: "slashMenu",
      store: stores.slash,
    }),
    ...(["[[", "@"] as const).map((char) =>
      createSuggestionExtension<EditorReference>({
        allowedPrefixes: char === "@" ? [" ", "("] : null,
        apply: applyReference,
        char,
        items: async (query) =>
          (await context.features().findReferences?.(query)) ?? [],
        name: char === "@" ? "mentionMenu" : "referenceMenu",
        store: stores.references,
      }),
    ),
    createSuggestionExtension<EmojiEntry>({
      apply: (editor, range, entry) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent(entry.emoji)
          .run(),
      char: ":",
      items: (query) => searchEmoji(query, 8),
      minQueryLength: 2,
      name: "emojiMenu",
      store: stores.emoji,
    }),
  ];
}
