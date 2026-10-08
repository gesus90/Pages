import { useTranslation } from "react-i18next";

import { UserAvatar } from "@/app/components/common/user-avatar";
import { UserPrivateWikiPages } from "@/app/components/users/user-private-wiki-pages";
import { UserRowActions } from "@/app/components/users/user-row-actions";

import type {
  AdministrationPageData,
  UserRole,
  ManagedUser,
} from "@/definition/Authorization";
import type { WikiPrivatePlaceholder } from "@/definition/Wiki";

interface UserRowProps {
  readonly directory: AdministrationPageData;
  readonly user: ManagedUser;
  readonly assignableRoles: readonly UserRole[];
  /** The private wiki pages of this account; empty unless an administrator looks. */
  readonly privateWikiPages: readonly WikiPrivatePlaceholder[];
}

/** Renders one user of the directory table. */
export function UserRow({
  directory,
  user,
  assignableRoles,
  privateWikiPages,
}: UserRowProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <tr className="transition-colors hover:bg-muted/40">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <UserAvatar user={user} size="xs" />
          <div className="flex min-w-0 flex-col">
            <span className="pages-selectable text-sm font-medium text-foreground">
              {user.displayName}
            </span>
            <UserPrivateWikiPages
              ownerName={user.displayName}
              pages={privateWikiPages}
            />
          </div>
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
