import {
  ArrowDown,
  ArrowUp,
  Copy,
  Languages,
  Link2,
  MessageSquareText,
  PenLine,
  Sparkles,
  SpellCheck,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { BLOCK_OPTIONS } from "@/app/components/editor/editor-block-catalog";
import { writeClipboardText } from "@/app/components/editor/editor-clipboard";
import {
  DropdownMenuItem,
  DropdownMenuShortcut,
} from "@/app/components/ui/dropdown-menu";
import {
  anchorBlock,
  BLOCK_KINDS,
  deleteBlock,
  duplicateBlock,
  findSelectedBlock,
  moveBlock,
  selectBlock,
  turnBlockInto,
} from "@/app/lib/editor/editor-commands";
import { formatShortcut } from "@/app/lib/editor/editor-shortcuts";

import type { Editor } from "@tiptap/core";
import type { LucideIcon } from "lucide-react";
import type { BlockEditorFeatures } from "@/app/components/editor/block-editor-types";
import type { BlockOption } from "@/app/components/editor/editor-block-catalog";
import type { BlockKind } from "@/app/lib/editor/editor-commands";
import type { EditorShortcut } from "@/app/lib/editor/editor-shortcuts";

/** The text assistant actions of the AI menu (A8 §3/§5). */
export const ASSISTANT_ACTIONS = [
  { icon: Languages, key: "translate" },
  { icon: SpellCheck, key: "proofread" },
  { icon: PenLine, key: "generate" },
  { icon: Sparkles, key: "summarize" },
  { icon: MessageSquareText, key: "explain" },
  { icon: WandSparkles, key: "instruct" },
] as const;

/** The entries of the slash menu that are block types, in menu order. */
const KIND_OPTIONS = BLOCK_OPTIONS.filter(
  (option): option is BlockOption & { readonly key: BlockKind } =>
    BLOCK_KINDS.some((kind) => kind === option.key),
);

interface MenuEntryProps {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly shortcut?: EditorShortcut;
  readonly isApple: boolean;
  readonly isDisabled?: boolean;
  readonly isDestructive?: boolean;
  readonly onSelect: () => void;
}

/** One entry of an editor menu: icon, name and shortcut. */
export function MenuEntry({
  icon: Icon,
  label,
  shortcut,
  isApple,
  isDisabled = false,
  isDestructive = false,
  onSelect,
}: MenuEntryProps): React.ReactElement {
  return (
    <DropdownMenuItem
      className={
        isDestructive
          ? "text-destructive data-highlighted:bg-destructive/10"
          : undefined
      }
      disabled={isDisabled}
      onSelect={onSelect}
    >
      <Icon aria-hidden="true" className="mr-2 size-4" />
      {label}
      {shortcut ? (
        <DropdownMenuShortcut>
          {formatShortcut(shortcut, isApple)}
        </DropdownMenuShortcut>
      ) : null}
    </DropdownMenuItem>
  );
}

interface BlockMenuProps {
  readonly editor: Editor;
  /** Position right before the block, or `null` for the selected block. */
  readonly position: number | null;
  readonly isApple: boolean;
}

function focusBlock(editor: Editor, position: number | null): void {
  if (position !== null) {
    selectBlock(editor, position);
  }
}

/** The block types a block can be turned into. */
export function BlockKindItems({
  editor,
  position,
  isApple,
}: BlockMenuProps): React.ReactElement {
  const { t } = useTranslation();

  function handleTurnInto(kind: BlockKind): void {
    focusBlock(editor, position);
    turnBlockInto(editor, kind);
  }

  return (
    <>
      {KIND_OPTIONS.map((option) => (
        <MenuEntry
          key={option.key}
          icon={option.icon}
          isApple={isApple}
          label={t(`editor.blocks.${option.key}`)}
          shortcut={option.shortcut}
          onSelect={() => handleTurnInto(option.key)}
        />
      ))}
    </>
  );
}

interface BlockActionItemsProps extends BlockMenuProps {
  readonly features: BlockEditorFeatures;
  readonly onNotice: (message: string) => void;
}

/** Duplicate, move, link and delete for one block. */
export function BlockActionItems({
  editor,
  position,
  isApple,
  features,
  onNotice,
}: BlockActionItemsProps): React.ReactElement {
  const { t } = useTranslation();
  const at = (): number | null =>
    position ?? findSelectedBlock(editor)?.position ?? null;

  async function handleCopyLink(): Promise<void> {
    const start = at();
    const anchor = start === null ? null : anchorBlock(editor, start);

    if (anchor === null) {
      return;
    }

    const link = features.blockLink?.(anchor) ?? `#block-${anchor}`;
    const isCopied = await writeClipboardText(link);

    onNotice(
      isCopied
        ? t("editor.notice.linkCopied")
        : t("editor.notice.linkManual", { link }),
    );
  }

  function run(action: (start: number) => boolean): void {
    const start = at();

    if (start !== null) {
      action(start);
    }
  }

  return (
    <>
      <MenuEntry
        icon={Copy}
        isApple={isApple}
        label={t("editor.block.duplicate")}
        shortcut="duplicate"
        onSelect={() => run((start) => duplicateBlock(editor, start))}
      />
      <MenuEntry
        icon={ArrowUp}
        isApple={isApple}
        label={t("editor.block.moveUp")}
        shortcut="moveUp"
        onSelect={() => run((start) => moveBlock(editor, start, "up"))}
      />
      <MenuEntry
        icon={ArrowDown}
        isApple={isApple}
        label={t("editor.block.moveDown")}
        shortcut="moveDown"
        onSelect={() => run((start) => moveBlock(editor, start, "down"))}
      />
      <MenuEntry
        icon={Link2}
        isApple={isApple}
        label={t("editor.block.copyLink")}
        onSelect={() => void handleCopyLink()}
      />
      <MenuEntry
        icon={Trash2}
        isApple={isApple}
        isDestructive
        label={t("editor.block.delete")}
        onSelect={() => run((start) => deleteBlock(editor, start))}
      />
    </>
  );
}

/** The actions of the text assistant, unavailable until it is connected. */
export function AssistantItems({
  features,
  isApple,
}: {
  readonly features: BlockEditorFeatures;
  readonly isApple: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const assistant = features.textAssistant;

  return (
    <>
      {assistant ? null : (
        <p className="max-w-64 px-3 py-2 text-xs text-muted-foreground">
          {t("editor.assistant.unavailable")}
        </p>
      )}
      {ASSISTANT_ACTIONS.map(({ icon, key }) => (
        <MenuEntry
          key={key}
          icon={icon}
          isApple={isApple}
          isDisabled={!assistant}
          label={t(`editor.assistant.${key}`)}
          onSelect={() => assistant?.open(key)}
        />
      ))}
    </>
  );
}
