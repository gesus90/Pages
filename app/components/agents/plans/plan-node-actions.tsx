import { MoreHorizontal, Pencil, Save, Trash2 } from "lucide-react";
import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { cn } from "@/app/lib/cn";

interface PlanNodeActionsProps {
  /** The node's name for the menu button; never a technical identifier. */
  readonly label: string;
  readonly disabled: boolean;
  readonly onRemove: () => void;
  /** Saves the node's configuration as a template; only parameter, agent and group nodes offer it. */
  readonly onSaveTemplate?: () => void;
  readonly shouldFocusCanvasOnRemove?: boolean;
  /** On a node card or a container the button is 28 px with an 8 px corner. */
  readonly size?: "default" | "card";
}

// Pointer and key events of the menu stay out of the canvas: no drag, pan or second delete.
function keepInMenu(event: React.SyntheticEvent): void {
  event.stopPropagation();
}

/**
 * The three-dot menu of a node: Save as template, where the node type offers
 * it, and Delete.
 * @remarks
 * Saving a template leaves the plan unchanged. Delete removes the node and
 * its own connections from the plan, never the ticket, agent, template or
 * runs it refers to. Without edit rights the menu is locked; the node dialog
 * opens from {@link PlanNodeEditButton}.
 */
export function PlanNodeActions({
  label,
  disabled,
  onRemove,
  onSaveTemplate,
  shouldFocusCanvasOnRemove = false,
  size = "default",
}: PlanNodeActionsProps): React.ReactElement {
  const { t } = useTranslation();
  const triggerId = useId();
  const removeFocus = useRef<HTMLElement | null>(null);
  const isDialogOpening = useRef(false);
  // A disabled trigger and disabled items keep both actions from running without edit rights.
  function remove(): void {
    if (shouldFocusCanvasOnRemove)
      removeFocus.current =
        document
          .getElementById(triggerId)
          ?.closest(".react-flow")
          ?.closest("section") ?? null;
    onRemove();
  }
  function saveTemplate(save: () => void): void {
    isDialogOpening.current = true;
    save();
  }
  function restoreFocus(event: Event): void {
    // The save dialog takes the focus; the trigger must not pull it back.
    if (isDialogOpening.current) {
      isDialogOpening.current = false;
      event.preventDefault();
      return;
    }
    if (!removeFocus.current) return;
    event.preventDefault();
    removeFocus.current.focus({ preventScroll: true });
    removeFocus.current = null;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          id={triggerId}
          size="icon-sm"
          variant="ghost"
          className={cn(
            "nodrag nopan shrink-0 text-muted-foreground",
            size === "card" && "size-7 min-h-7 rounded-lg xl:min-h-7",
          )}
          disabled={disabled}
          aria-label={t("settings.agents.actionsFor", { name: label })}
          onPointerDown={keepInMenu}
          onClick={keepInMenu}
          onDoubleClick={keepInMenu}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={restoreFocus}
        onClick={keepInMenu}
        onKeyDown={keepInMenu}
        onDoubleClick={keepInMenu}
      >
        {onSaveTemplate ? (
          <>
            <DropdownMenuItem
              disabled={disabled}
              className="gap-2.5"
              onSelect={() => saveTemplate(onSaveTemplate)}
            >
              <Save className="size-4 shrink-0" aria-hidden="true" />
              {t("plans.templates.saveAction")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem
          disabled={disabled}
          className="gap-2.5 text-destructive"
          onSelect={remove}
        >
          <Trash2 className="size-4 shrink-0" aria-hidden="true" />
          {t("plans.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Opens the node dialog of an agent or a group beside its menu.
 * @remarks
 * Instructions, completion, model and group members are edited there. It
 * stays available without edit rights, where the dialog is read only.
 */
export function PlanNodeEditButton(props: {
  /** The node's name; never a technical identifier. */
  readonly label: string;
  readonly onEdit: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const label = t("plans.editNamed", { name: props.label });
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className="nodrag nopan size-7 min-h-7 shrink-0 rounded-lg text-muted-foreground xl:min-h-7"
      aria-label={label}
      title={label}
      onPointerDown={keepInMenu}
      onClick={(event) => {
        keepInMenu(event);
        props.onEdit();
      }}
      onDoubleClick={keepInMenu}
    >
      <Pencil className="size-3.5" aria-hidden="true" />
    </Button>
  );
}
