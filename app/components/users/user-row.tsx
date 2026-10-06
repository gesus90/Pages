import { useTranslation } from "react-i18next";

import { UserAvatar } from "@/app/components/common/user-avatar";
import { UserRowActions } from "@/app/components/users/user-row-actions";

import type {
  AdministrationPageData,
  UserRole,
  ManagedUser,
} from "@/definition/Authorization";

interface UserRowProps {
  readonly directory: AdministrationPageData;
  readonly user: ManagedUser;
  readonly assignableRoles: readonly UserRole[];
}

/** Renders one user of the directory table. */
export function UserRow({
  directory,
  user,
  assignableRoles,
}: UserRowProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <tr className="transition-colors hover:bg-muted/40">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <UserAvatar user={user} size="xs" />
          <span className="pages-selectable text-sm font-medium text-foreground">
            {user.displayName}
          </span>
        </div>
      </td>
      <td className="pages-selectable px-4 py-3 text-sm text-muted-foreground">
        {user.username}
      </td>
      <td className="max-w-56 px-4 py-3">
        {user.email ? (
          <span
            className="pages-selectable block truncate text-sm text-muted-foreground"
            title={user.email}
          >
            {user.email}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground/50">—</span>
        )}
      </td>
      <td className="pages-selectable px-4 py-3 text-sm text-foreground">
        {user.account.role?.name ?? "—"}
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center gap-2 text-sm">
          <span
            aria-hidden="true"
            className={
              user.isActive
                ? "size-2 rounded-full bg-success-dot"
                : "size-2 rounded-full bg-muted-foreground/50"
            }
          />
          <span
            className={
              user.isActive ? "text-foreground" : "text-muted-foreground"
            }
          >
            {t(user.isActive ? "users.status.active" : "users.status.inactive")}
          </span>
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <UserRowActions
          user={user}
          assignableRoles={assignableRoles}
          directory={directory}
        />
      </td>
    </tr>
  );
}
