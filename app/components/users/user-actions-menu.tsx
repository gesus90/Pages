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

import type { ManagedUser } from "@/definition/Authorization";

interface UserActionsMenuProps {
  readonly onMemberships: () => void;
  readonly onScope: () => void;
  readonly onAdmin: () => void;
  readonly user: ManagedUser;
  readonly onEdit: () => void;
  readonly onChangeRole: () => void;
  readonly onResetPassword: () => void;
  readonly onDeactivate: () => void;
  readonly onActivate: () => void;
}

/** Renders the menu with the actions available for a user. */
export function UserActionsMenu({
  onMemberships,
  onScope,
  onAdmin,
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
        {user.canManageMemberships ? (
          <DropdownMenuItem onSelect={onMemberships}>
            {t("users.access.memberships")}
          </DropdownMenuItem>
        ) : null}
        {user.canManageScope ? (
          <>
            <DropdownMenuItem onSelect={onScope}>
              {t("users.access.scope")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onAdmin}>
              {t("users.personalAdmin")}
            </DropdownMenuItem>
          </>
        ) : null}
        {user.canEditProfile ? (
          <DropdownMenuItem className="gap-2.5" onSelect={onEdit}>
            <Pencil
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            {t("users.menu.edit")}
          </DropdownMenuItem>
        ) : null}
        {user.canEditProfile ? (
          <DropdownMenuItem className="gap-2.5" onSelect={onChangeRole}>
            <ShieldCheck
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            {t("users.menu.changeRole")}
          </DropdownMenuItem>
        ) : null}
        {user.canManageAccess ? (
          <>
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
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
