import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { Suggestion } from "@tiptap/suggestion";

import type { Editor, Range } from "@tiptap/core";
import type { SuggestionStore } from "@/app/components/editor/menus/suggestion-store";

/** How a suggestion menu is triggered and what it offers. */
export interface SuggestionDefinition<Item> {
  /** Unique name of the extension and its plugin. */
  readonly name: string;
  /** Characters that open the menu, such as `/`, `[[` or `:`. */
  readonly char: string;
  readonly store: SuggestionStore<Item>;
  /** Finds the items for the typed query. */
  readonly items: (query: string) => readonly Item[] | Promise<readonly Item[]>;
  /** Applies the chosen item in place of the trigger text. */
  readonly apply: (editor: Editor, range: Range, item: Item) => void;
  /** Characters allowed right before the trigger; `null` allows any. */
  readonly allowedPrefixes?: readonly string[] | null;
  /** Shortest query that opens the menu. */
  readonly minQueryLength?: number;
}

/**
 * Creates an editor extension that opens a suggestion menu while the
 * person types its trigger, and routes the menu keys to the store.
 *
 * @param definition - Trigger, items and action of the menu.
 * @returns The extension.
 *
 * @remarks
 * Menus never open inside code, where the characters are plain text.
 */
export function createSuggestionExtension<Item>(
  definition: SuggestionDefinition<Item>,
): Extension {
  const { store } = definition;

  return Extension.create({
    addProseMirrorPlugins() {
      return [
        Suggestion<Item, Item>({
          allow: ({ state, range }) =>
            !state.doc.resolve(range.from).parent.type.spec.code,
          allowedPrefixes:
            definition.allowedPrefixes === undefined
              ? [" "]
              : (definition.allowedPrefixes?.slice() ?? null),
          char: definition.char,
          command: ({ editor, range, props }) =>
            definition.apply(editor, range, props),
          editor: this.editor,
          items: async ({ query }) => [...(await definition.items(query))],
          minQueryLength: definition.minQueryLength ?? 0,
          pluginKey: new PluginKey(definition.name),
          render: () => ({
            onExit: () => store.hide(),
            onKeyDown: ({ event }) => store.handleKey(event),
            onStart: (props) => store.show(props),
            onUpdate: (props) => store.show(props),
          }),
        }),
      ];
    },
    name: definition.name,
  });
}
