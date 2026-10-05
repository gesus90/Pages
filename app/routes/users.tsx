import { Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useActionData, useLoaderData } from "react-router";

import { Input } from "@/app/components/ui/input";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { CreateUserDialog } from "@/app/components/users/create-user-dialog";
import { UserRow } from "@/app/components/users/user-row";
import {
  authenticatedUserContext,
  requirePermission,
} from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { handleUsersAction } from "@/app/lib/user-actions/user-actions.server";
import { PERMISSION, ROLE } from "@/definition/Role";

import type { MiddlewareFunction } from "react-router";
import type { ChangeEvent } from "react";
import type {
  UsersActionData,
  UsersActionResult,
  UsersIntent,
} from "@/app/lib/user-actions/user-action-support.server";
import type { Role } from "@/definition/Role";
import type { UserListItem } from "@/definition/User";
import type { Route } from "./+types/users";

/**
 * Intents without a dialog of their own that can display a failure, so the
 * directory reports them. The other intents show their errors in their dialog.
 */
const DIRECTORY_ERROR_INTENTS: ReadonlySet<UsersIntent> = new Set([
  "set-active",
  "reset-password",
]);

interface UsersLoaderData {
  readonly users: readonly UserListItem[];
  readonly assignableRoles: readonly Role[];
}

/** Restricts a leaf route to users allowed to view the user directory. */
export const middleware: MiddlewareFunction[] = [
  requirePermission(PERMISSION.VIEW_USERS),
];

/** Loads the user directory with email addresses for the management table. */
export async function loader({
  context,
}: Route.LoaderArgs): Promise<UsersLoaderData> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();
  const users = await services.userService.findAll(actor);
  const emails = await services.userService.findEmailAddresses(
    actor,
    users.map((user) => user.id),
  );

  return {
    assignableRoles:
      actor.role === ROLE.ADMIN
        ? [ROLE.ADMIN, ROLE.MANAGER, ROLE.EMPLOYEE]
        : [ROLE.EMPLOYEE],
    users: users.map((user) => ({
      ...user,
      canManage: services.permissionService.canManageUser(
        actor.role,
        user.role,
      ),
      email: emails.get(user.id) ?? null,
    })),
  };
}
/** Creates users and applies directory mutations for authorized actors. */
export async function action({
  request,
  context,
}: Route.ActionArgs): Promise<UsersActionResult> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();

  return handleUsersAction(formData.get("intent"), {
    actor,
    formData,
    services: await getApplicationServices(),
  });
}

function matchesSearch(user: UserListItem, query: string): boolean {
  if (query === "") {
    return true;
  }

  return [user.displayName, user.username, user.email ?? ""].some((value) =>
    value.toLowerCase().includes(query),
  );
}

/** Renders the open, table-first user-management screen. */
export default function UsersRoute(): React.ReactElement {
  const { t } = useTranslation();
  const { users, assignableRoles } = useLoaderData<typeof loader>();
  const actionData = useActionData<UsersActionData | undefined>();
  const [search, setSearch] = useState("");
  const rowActionError =
    actionData &&
    !actionData.ok &&
    DIRECTORY_ERROR_INTENTS.has(actionData.intent)
      ? actionData.error
      : null;
  const visibleUsers = users.filter((user) =>
    matchesSearch(user, search.trim().toLowerCase()),
  );

  function handleSearchChange(event: ChangeEvent<HTMLInputElement>): void {
    setSearch(event.currentTarget.value);
  }

  return (
    <section className="mx-auto flex h-[calc(100dvh-8.5rem)] min-h-80 w-full max-w-6xl flex-col">
      <div className="flex shrink-0 items-center justify-between gap-4">
        <h1 className="select-none text-2xl font-semibold tracking-tight text-foreground xl:text-xl">
          {t("users.title")}
        </h1>
        <CreateUserDialog assignableRoles={assignableRoles} />
      </div>

      {rowActionError ? (
        <p className="mt-4 shrink-0 text-sm text-destructive" role="alert">
          {t(`users.error.${rowActionError}`)}
        </p>
      ) : null}

      <div className="relative mt-6 h-9 w-full shrink-0 sm:max-w-80">
        <Search
          className="pointer-events-none absolute top-1/2 left-4 size-4 shrink-0 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          className="h-9 rounded-lg bg-card pr-3 pl-11 text-xs xl:pr-3 xl:pl-11"
          value={search}
          onChange={handleSearchChange}
          placeholder={t("users.search.placeholder")}
          aria-label={t("users.search.placeholder")}
          type="search"
        />
      </div>

      <VerticalScrollArea
        className="mt-4 min-h-0 flex-1"
        contentClassName="pr-5"
      >
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b border-border text-xs font-medium tracking-wide text-muted-foreground uppercase select-none">
              <th className="px-4 py-2.5 font-medium">
                {t("users.columns.user")}
              </th>
              <th className="px-4 py-2.5 font-medium">
                {t("users.columns.username")}
              </th>
              <th className="px-4 py-2.5 font-medium">
                {t("users.columns.email")}
              </th>
              <th className="px-4 py-2.5 font-medium">
                {t("users.columns.role")}
              </th>
              <th className="px-4 py-2.5 font-medium">
                {t("users.columns.status")}
              </th>
              <th className="px-4 py-2.5 text-right font-medium">
                {t("users.columns.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.length > 0 ? (
              visibleUsers.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  assignableRoles={assignableRoles}
                />
              ))
            ) : (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-sm text-muted-foreground"
                >
                  {t("users.search.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </VerticalScrollArea>
    </section>
  );
}
