import { useTranslation } from "react-i18next";

import { UserAvatar } from "@/app/components/common/user-avatar";
import { UserRowActions } from "@/app/components/users/user-row-actions";

import type { Role } from "@/definition/Role";
import type { UserListItem } from "@/definition/User";

interface UserRowProps {
  readonly user: UserListItem;
  readonly assignableRoles: readonly Role[];
}

/** Renders one user of the directory table. */
export function UserRow({
  user,
  assignableRoles,
}: UserRowProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <tr className="border-b border-border transition-colors last:border-0 hover:bg-surface">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <UserAvatar user={user} />
          <span className="text-sm font-medium text-foreground">
            {user.displayName}
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {user.username}
      </td>
      <td className="max-w-56 px-4 py-3">
        {user.email ? (
          <span
            className="block truncate text-sm text-muted-foreground"
            title={user.email}
          >
            {user.email}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground/50">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-foreground">
        {t(`role.${user.role}`)}
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center gap-2 text-sm">
          <span
            aria-hidden="true"
            className={
              user.isActive
                ? "size-2 rounded-full bg-emerald-500"
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
        <UserRowActions user={user} assignableRoles={assignableRoles} />
      </td>
    </tr>
  );
}
