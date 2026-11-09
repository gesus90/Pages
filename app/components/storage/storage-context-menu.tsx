import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { cn } from "@/app/lib/cn";

import type { StorageCommand } from "./storage-commands";

/** Where the context menu opens, in viewport coordinates. */
export interface StorageMenuPoint {
  readonly x: number;
  readonly y: number;
}

interface StorageContextMenuProps {
  readonly commands: readonly StorageCommand[];
  /** The pointer position of the right click; `null` keeps the menu closed. */
  readonly point: StorageMenuPoint | null;
  readonly onClose: () => void;
}

/**
 * The own context menu of the Storage list (PAGE-272): the same actions as
 * the menu bar at the position of the right click.
 *
 * @remarks
 * No context-menu dependency is used: the existing `DropdownMenu` is
 * anchored to an invisible point at the pointer position. Radix moves the
 * focus into the menu, so arrows, Enter and Escape work as in every menu.
 */
export function StorageContextMenu({
  commands,
  point,
  onClose,
}: StorageContextMenuProps): React.ReactElement {
  const { t } = useTranslation();

  function handleOpenChange(isOpen: boolean): void {
    if (!isOpen) onClose();
  }

  return (
    <DropdownMenu modal onOpenChange={handleOpenChange} open={point !== null}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed size-0"
          style={{ left: point?.x ?? 0, top: point?.y ?? 0 }}
          tabIndex={-1}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        aria-label={t("storage.menu.label")}
        className="min-w-52"
        side="bottom"
        sideOffset={2}
      >
        {commands.map((command) => {
          const Icon = command.icon;
          const hint =
            command.isDisabled && command.hintKey !== null
              ? t(command.hintKey)
              : null;

          return (
            <Fragment key={command.id}>
              <DropdownMenuItem
                className={cn(
                  "flex-wrap",
                  command.isDestructive ? "text-destructive" : null,
                )}
                disabled={command.isDisabled}
                onSelect={command.run}
              >
                <Icon aria-hidden="true" className="mr-2 size-4" />
                {t(`storage.menu.${command.id}`)}
                {command.isPressed === true ? (
                  <span className="ml-auto pl-3 text-xs text-muted-foreground">
                    {t("storage.menu.on")}
                  </span>
                ) : null}
                {hint === null ? null : (
                  <span className="basis-full pl-6 text-xs text-muted-foreground">
                    {hint}
                  </span>
                )}
              </DropdownMenuItem>
              {command.endsGroup ? <DropdownMenuSeparator /> : null}
            </Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
