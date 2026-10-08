import {
  Bold,
  CheckSquare,
  ChevronsDownUp,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Info,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Table,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import type { WikiEditorCommand } from "@/app/lib/wiki-editor-commands";

type ToolbarCommand = Exclude<WikiEditorCommand, "contents" | "divider">;

const ICONS: Readonly<Record<ToolbarCommand, typeof Bold>> = {
  bold: Bold,
  bullet: List,
  callout: Info,
  code: Code,
  codeBlock: Code2,
  heading1: Heading1,
  heading2: Heading2,
  heading3: Heading3,
  italic: Italic,
  link: Link2,
  numbered: ListOrdered,
  quote: Quote,
  table: Table,
  task: CheckSquare,
  toggle: ChevronsDownUp,
};

/** Commands the toolbar shows, in order. */
export const TOOLBAR_COMMANDS: readonly ToolbarCommand[] = [
  "heading1",
  "heading2",
  "heading3",
  "bold",
  "italic",
  "code",
  "link",
  "bullet",
  "numbered",
  "task",
  "quote",
  "codeBlock",
  "table",
  "callout",
  "toggle",
];

interface WikiEditorToolbarProps {
  readonly onCommand: (command: WikiEditorCommand) => void;
  /** More buttons after the formatting commands, such as attachments. */
  readonly children?: React.ReactNode;
}

/** The formatting buttons above the editor text. */
export function WikiEditorToolbar({
  onCommand,
  children,
}: WikiEditorToolbarProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div
      aria-label={t("wiki.editor.toolbar")}
      className="flex flex-wrap items-center gap-0.5 border-b border-border pb-2"
      role="toolbar"
    >
      {TOOLBAR_COMMANDS.map((command) => {
        const Icon = ICONS[command];

        return (
          <Button
            key={command}
            aria-label={t(`wiki.editor.command.${command}`)}
            size="icon-sm"
            title={t(`wiki.editor.command.${command}`)}
            variant="ghost"
            onClick={() => onCommand(command)}
          >
            <Icon aria-hidden="true" className="size-4" />
          </Button>
        );
      })}
      {children}
    </div>
  );
}
