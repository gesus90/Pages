import {
  Check,
  KeyRound,
  MoreHorizontal,
  Pencil,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

import type { UserListItem } from "@/definition/User";

interface UserActionsMenuProps {
  readonly user: UserListItem;
  readonly onEdit: () => void;
  readonly onChangeRole: () => void;
  readonly onResetPassword: () => void;
  readonly onDeactivate: () => void;
  readonly onActivate: () => void;
}

/** Renders the menu with the actions available for a user. */
export function UserActionsMenu({
  user,
  onEdit,
  onChangeRole,
  onResetPassword,
  onDeactivate,
  onActivate,
}: UserActionsMenuProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={t("users.menu.trigger", { name: user.displayName })}
          className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          type="button"
        >
          <MoreHorizontal className="size-5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem className="gap-2.5" onSelect={onEdit}>
          <Pencil className="size-4 text-muted-foreground" aria-hidden="true" />
          {t("users.menu.edit")}
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2.5" onSelect={onChangeRole}>
          <ShieldCheck
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          {t("users.menu.changeRole")}
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2.5" onSelect={onResetPassword}>
          <KeyRound
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          {t("users.menu.resetPassword")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {user.isActive ? (
          <DropdownMenuItem
            className="gap-2.5 text-destructive hover:text-destructive focus:text-destructive"
            onSelect={onDeactivate}
          >
            <TriangleAlert className="size-4" aria-hidden="true" />
            {t("users.actions.deactivate")}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem className="gap-2.5" onSelect={onActivate}>
            <Check
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            {t("users.actions.activate")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
