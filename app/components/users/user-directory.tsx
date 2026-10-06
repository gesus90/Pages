import { Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useActionData } from "react-router";
import { Input } from "@/app/components/ui/input";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { CreateUserDialog } from "@/app/components/users/create-user-dialog";
import { UserDirectoryTable } from "./user-directory/user-directory-table";

import type {
  AdministrationPageData,
  ManagedUser,
} from "@/definition/Authorization";
import type { UsersActionData } from "@/app/lib/user-actions/user-action-support.server";

function matchesSearch(user: ManagedUser, query: string): boolean {
  return (
    query === "" ||
    [user.displayName, user.username, user.email ?? ""].some((entry) =>
      entry.toLowerCase().includes(query),
    )
  );
}

/** Lists only server-authorized identities and their independently authorized actions. */
export function UserDirectory({
  directory,
}: {
  readonly directory: AdministrationPageData;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const actionData = useActionData<UsersActionData>();
  const [search, setSearch] = useState("");
  const error =
    actionData &&
    !actionData.ok &&
    (actionData.intent === "set-active" ||
      actionData.intent === "reset-password")
      ? actionData.error
      : null;
  const visibleUsers = directory.users.filter((user) =>
    matchesSearch(user, search.trim().toLowerCase()),
  );
  function resetSearch(): void {
    setSearch("");
  }
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="mb-6 flex shrink-0 flex-wrap items-center justify-between gap-2.5">
        <div className="relative min-w-52 flex-1 sm:max-w-80">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            size="sm"
            className="pl-10 xl:pl-10"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder={t("users.search.placeholder")}
            aria-label={t("users.search.placeholder")}
            type="search"
          />
        </div>
        {directory.canCreate ? (
          <CreateUserDialog
            assignableRoles={directory.assignableRoles}
            departments={directory.departments.filter((department) =>
              directory.adoptableDepartmentIds.includes(department.id),
            )}
            canCreateAdmin={
              directory.actor.isAdmin && directory.actor.mode === "admin"
            }
          />
        ) : null}
        <span className="text-xs tabular-nums text-muted-foreground">
          {new Intl.NumberFormat(i18n.language).format(visibleUsers.length)}{" "}
          {t("users.sections.users")}
        </span>
      </div>
      {error ? (
        <p
          className="pages-selectable mb-4 text-sm text-destructive"
          role="alert"
        >
          {t(`users.error.${error}`)}
        </p>
      ) : null}
      <VerticalScrollArea
        className="min-h-0 flex-1"
        contentClassName="px-1 pt-1 pb-10"
      >
        <UserDirectoryTable
          directory={directory}
          visibleUsers={visibleUsers}
          hasFilter={search.trim() !== ""}
          onReset={resetSearch}
        />
      </VerticalScrollArea>
    </section>
  );
}
