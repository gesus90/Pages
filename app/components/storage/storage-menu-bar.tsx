import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import type { StorageCommand } from "./storage-commands";
import type { StorageClipboard } from "./use-storage-batch";

interface StorageMenuBarProps {
  readonly commands: readonly StorageCommand[];
  readonly selectedCount: number;
  readonly clipboard: StorageClipboard | null;
}

function CommandButton({
  command,
}: {
  readonly command: StorageCommand;
}): React.ReactElement {
  const { t } = useTranslation();
  const Icon = command.icon;
  const label = t(`storage.menu.${command.id}`);
  const hint = command.hintKey === null ? undefined : t(command.hintKey);

  return (
    // A disabled button shows no tooltip, so the wrapper carries the hint.
    <span className="inline-flex" title={command.isDisabled ? hint : undefined}>
      <Button
        aria-label={label}
        aria-pressed={command.isPressed ?? undefined}
        className={cn(
          command.isDestructive ? "text-destructive" : null,
          command.isPressed === true ? "bg-muted" : null,
        )}
        disabled={command.isDisabled}
        onClick={command.run}
        size="xs"
        type="button"
        variant="ghost"
      >
        <Icon aria-hidden="true" className="size-3.5" />
        <span className="max-lg:sr-only">{label}</span>
      </Button>
    </span>
  );
}

/** Says how many entries are selected and what waits to be pasted. */
function MenuStatus({
  selectedCount,
  clipboard,
}: Omit<StorageMenuBarProps, "commands">): React.ReactElement {
  const { t } = useTranslation();

  return (
    <p
      aria-live="polite"
      className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground"
    >
      {clipboard === null ? null : (
        <span>
          {t(`storage.menu.clipboard.${clipboard.mode}`, {
            count: clipboard.entries.length,
          })}
        </span>
      )}
      <span className="font-semibold text-foreground">
        {t("storage.menu.selected", { count: selectedCount })}
      </span>
    </p>
  );
}

/**
 * The menu bar above the Storage list (PAGE-272): the file actions, the
 * multi-select switch and select all, with the selection and the clipboard
 * on the right. Actions that are not available are disabled.
 */
export function StorageMenuBar({
  commands,
  selectedCount,
  clipboard,
}: StorageMenuBarProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
      <div
        aria-label={t("storage.menu.label")}
        className="flex flex-wrap items-center gap-0.5"
        role="toolbar"
      >
        {commands.map((command) => (
          <Fragment key={command.id}>
            <CommandButton command={command} />
            {command.endsGroup ? (
              <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
            ) : null}
          </Fragment>
        ))}
      </div>
      <MenuStatus clipboard={clipboard} selectedCount={selectedCount} />
    </div>
  );
}
