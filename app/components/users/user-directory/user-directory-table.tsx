import { useTranslation } from "react-i18next";
import { Button } from "@/app/components/ui/button";
import { ManagementTable } from "@/app/components/users/management-table";
import { UserRow } from "@/app/components/users/user-row";
import type {
  AdministrationPageData,
  ManagedUser,
} from "@/definition/Authorization";
import type { WikiPrivatePagesByOwner } from "@/definition/Wiki";

interface UserDirectoryTableProps {
  readonly directory: AdministrationPageData;
  readonly visibleUsers: readonly ManagedUser[];
  readonly privateWikiPages: WikiPrivatePagesByOwner;
  readonly hasFilter: boolean;
  readonly onReset: () => void;
}

/** Renders authorized rows and distinguishes an empty directory from a filtered result. */
export function UserDirectoryTable({
  directory,
  visibleUsers,
  privateWikiPages,
  hasFilter,
  onReset,
}: UserDirectoryTableProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <ManagementTable>
      <thead className="sticky top-0 z-10 bg-muted/40 text-xs font-medium text-muted-foreground">
        <tr>
          {["user", "username", "email", "role", "status", "actions"].map(
            (column) => (
              <th key={column} className="px-4 py-3 font-medium">
                {t(`users.columns.${column}`)}
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody className="divide-y divide-border/60">
        {visibleUsers.length > 0 ? (
          visibleUsers.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              assignableRoles={directory.assignableRoles}
              directory={directory}
              privateWikiPages={privateWikiPages[user.id] ?? []}
            />
          ))
        ) : (
          <tr>
            <td
              colSpan={6}
              className="px-4 py-10 text-center text-sm text-muted-foreground"
            >
              {t("users.search.empty")}
              {hasFilter ? (
                <Button variant="ghost" size="sm" onClick={onReset}>
                  {t("users.search.reset")}
                </Button>
              ) : null}
            </td>
          </tr>
        )}
      </tbody>
    </ManagementTable>
  );
}
