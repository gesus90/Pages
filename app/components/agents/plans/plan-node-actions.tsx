import { MoreHorizontal } from "lucide-react";
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
}: PlanNodeActionsProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          className="shrink-0 text-muted-foreground"
          disabled={disabled && !onEdit}
          aria-label={t("settings.agents.actionsFor", { name: label })}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
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
          onSelect={onRemove}
        >
          {t("plans.deleteNode", { name: label })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
