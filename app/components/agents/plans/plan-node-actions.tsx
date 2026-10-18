import { MoreHorizontal } from "lucide-react";
import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

interface PlanNodeActionsProps {
  readonly label: string;
  readonly disabled: boolean;
  readonly onRemove: () => void;
  readonly onEdit?: () => void;
  readonly removeLabel?: string;
  readonly shouldFocusCanvasOnRemove?: boolean;
}

/**
 * Keeps destructive node actions inside the same keyboard-accessible menu.
 *
 * @remarks
 * Opening the node dialog stays possible without edit rights, where it is
 * read only; a double click opens the agent console instead.
 */
export function PlanNodeActions({
  label,
  disabled,
  onRemove,
  onEdit,
  removeLabel,
  shouldFocusCanvasOnRemove = false,
}: PlanNodeActionsProps): React.ReactElement {
  const { t } = useTranslation();
  const triggerId = useId();
  const removeFocus = useRef<HTMLElement | null>(null);
  function remove(): void {
    if (disabled) return;
    if (shouldFocusCanvasOnRemove)
      removeFocus.current =
        document
          .getElementById(triggerId)
          ?.closest(".react-flow")
          ?.closest("section") ?? null;
    onRemove();
  }
  function restoreFocus(event: Event): void {
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
          className="nodrag nopan shrink-0 text-muted-foreground"
          disabled={disabled && !onEdit}
          aria-label={t("settings.agents.actionsFor", { name: label })}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={restoreFocus}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {onEdit ? (
          <DropdownMenuItem onSelect={onEdit}>
            {t("settings.agents.edit")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          disabled={disabled}
          className="text-destructive"
          onSelect={remove}
        >
          {removeLabel ?? t("plans.deleteNode", { name: label })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
