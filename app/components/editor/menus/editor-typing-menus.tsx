import { useTranslation } from "react-i18next";

import { SuggestionMenu } from "@/app/components/editor/menus/suggestion-menu";
import { formatShortcut } from "@/app/lib/editor/editor-shortcuts";

import type { Editor } from "@tiptap/core";
import type { BlockEditorFeatures } from "@/app/components/editor/block-editor-types";
import type { BlockOption } from "@/app/components/editor/editor-block-catalog";
import type { EditorMenuStores } from "@/app/components/editor/editor-menu-extensions";

interface EditorTypingMenusProps {
  readonly editor: Editor;
  readonly stores: EditorMenuStores;
  readonly features: BlockEditorFeatures;
  readonly isApple: boolean;
  /** Prefix of the list identifiers, unique per editor. */
  readonly id: string;
}

function BlockOptionRow({
  option,
  isApple,
}: {
  readonly option: BlockOption;
  readonly isApple: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const { icon: Icon } = option;

  return (
    <>
      <Icon
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="flex-1">{t(`editor.blocks.${option.key}`)}</span>
      {option.markdown ? (
        <code className="rounded bg-muted px-1 font-mono text-xs text-muted-foreground">
          {option.markdown}
        </code>
      ) : null}
      {option.shortcut ? (
        <span className="text-xs text-muted-foreground">
          {formatShortcut(option.shortcut, isApple)}
        </span>
      ) : null}
    </>
  );
}

/**
 * The menus that open while typing: `/` for blocks (the Notion slash menu),
 * `[[` and `@` for pages, tickets and people, `:` for emoji.
 */
export function EditorTypingMenus({
  editor,
  stores,
  features,
  isApple,
  id,
}: EditorTypingMenusProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      <SuggestionMenu
        editor={editor}
        emptyLabel={t("editor.menu.noMatch")}
        getKey={(option) => option.key}
        groupLabel={(option) => t(`editor.blockGroups.${option.group}`)}
        id={`${id}-slash`}
        isEnabled={(option) =>
          option.key !== "assistant" || features.textAssistant !== undefined
        }
        label={t("editor.menu.blocks")}
        renderItem={(option) => (
          <BlockOptionRow isApple={isApple} option={option} />
        )}
        store={stores.slash}
      />
      <SuggestionMenu
        editor={editor}
        emptyLabel={t("editor.menu.noMatch")}
        getKey={(reference) => reference.key}
        id={`${id}-references`}
        label={t("editor.menu.references")}
        renderItem={(reference) => (
          <>
            <span className="flex-1 truncate">{reference.label}</span>
            <span className="text-xs text-muted-foreground">
              {reference.hint}
            </span>
          </>
        )}
        store={stores.references}
      />
      <SuggestionMenu
        editor={editor}
        emptyLabel={t("editor.emoji.empty")}
        getKey={(entry) => entry.emoji}
        id={`${id}-emoji`}
        label={t("editor.menu.emoji")}
        renderItem={(entry) => (
          <>
            <span className="text-lg">{entry.emoji}</span>
            <span className="truncate text-muted-foreground">
              {entry.keywords.split(" ").slice(0, 3).join(" ")}
            </span>
          </>
        )}
        store={stores.emoji}
      />
    </>
  );
}
