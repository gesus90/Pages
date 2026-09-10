import { randomUUID } from "node:crypto";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Form,
  data,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";

import { Button } from "@/app/components/ui/button";
import { PageContent } from "@/app/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { UserAvatar } from "@/app/components/common/user-avatar";
import {
  authenticatedUserContext,
  requirePermission,
} from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { UsernameTakenError } from "@/backend/database/repositories/UserRepository";
import {
  LastAdministratorError,
  RoleAssignmentDeniedError,
  UserManagementDeniedError,
  UserNotFoundError,
} from "@/backend/service/UserService";
import { PERMISSION, ROLE, isRole } from "@/definition/Role";

import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MiddlewareFunction,
} from "react-router";
import type { ApplicationServices } from "@/app/lib/services.server";
import type { Role } from "@/definition/Role";
import type { User } from "@/definition/User";

const MAXIMUM_NAME_LENGTH = 200;
const MAXIMUM_USERNAME_LENGTH = 200;
const MINIMUM_PASSWORD_LENGTH = 8;
const MAXIMUM_PASSWORD_LENGTH = 1000;

type UsersErrorCode =
  | "usernameTaken"
  | "invalidInput"
  | "forbidden"
  | "lastAdministrator"
  | "userNotFound";

type UsersIntent = "create-user" | "set-active";

type UsersActionResult =
  | { readonly ok: true; readonly intent: UsersIntent }
  | {
      readonly ok: false;
      readonly intent: UsersIntent;
      readonly error: UsersErrorCode;
    };

interface UserListItem extends User {
  readonly canManage: boolean;
}

interface UsersLoaderData {
  readonly users: readonly UserListItem[];
  readonly assignableRoles: readonly Role[];
}

interface CreateUserInput {
  readonly displayName: string;
  readonly username: string;
  readonly password: string;
  readonly role: Role;
}

/** Restricts a leaf route to users allowed to view the user directory. */
export const middleware: MiddlewareFunction[] = [
  requirePermission(PERMISSION.VIEW_USERS),
];

/** Loads the user directory for the currently authenticated actor. */
export async function loader({
  context,
}: LoaderFunctionArgs): Promise<UsersLoaderData> {
  const actor = context.get(authenticatedUserContext);

  if (!actor) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();
  const users = await services.userService.findAll(actor);

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
    })),
  };
}

/** Creates users and toggles their active state for authorized actors. */
export async function action({
  request,
  context,
}: ActionFunctionArgs): Promise<ReturnType<typeof data<UsersActionResult>>> {
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
  const intent = formData.get("intent");
  const services = await getApplicationServices();

  if (intent === "create-user") {
    return handleCreateUser(actor, formData, services);
  }

  if (intent === "set-active") {
    return handleSetActive(actor, formData, services);
  }

  return data<UsersActionResult>(
    { error: "invalidInput", intent: "create-user", ok: false },
    { status: 400 },
  );
}

function parseCreateUserInput(
  formData: FormData,
  actorRole: Role,
): CreateUserInput | null {
  const displayName = formData.get("displayName");
  const username = formData.get("username");
  const password = formData.get("password");
  const requestedRole = formData.get("role");

  if (
    typeof displayName !== "string" ||
    typeof username !== "string" ||
    typeof password !== "string"
  ) {
    return null;
  }

  const trimmedDisplayName = displayName.trim();
  const trimmedUsername = username.trim();

  if (
    !trimmedDisplayName ||
    !trimmedUsername ||
    password.length < MINIMUM_PASSWORD_LENGTH
  ) {
    return null;
  }

  if (
    trimmedDisplayName.length > MAXIMUM_NAME_LENGTH ||
    trimmedUsername.length > MAXIMUM_USERNAME_LENGTH ||
    password.length > MAXIMUM_PASSWORD_LENGTH
  ) {
    return null;
  }

  const role =
    actorRole === ROLE.ADMIN && isRole(requestedRole)
      ? requestedRole
      : ROLE.EMPLOYEE;

  return {
    displayName: trimmedDisplayName,
    password,
    role,
    username: trimmedUsername,
  };
}

async function handleCreateUser(
  actor: User,
  formData: FormData,
  services: ApplicationServices,
): Promise<ReturnType<typeof data<UsersActionResult>>> {
  const input = parseCreateUserInput(formData, actor.role);

  if (!input) {
    return data<UsersActionResult>(
      { error: "invalidInput", intent: "create-user", ok: false },
      { status: 400 },
    );
  }

  try {
    const passwordHash = await services.passwordHasher.hash(input.password);

    await services.userService.createUser(actor, {
      displayName: input.displayName,
      id: randomUUID(),
      passwordHash,
      role: input.role,
      username: input.username,
    });
  } catch (error: unknown) {
    if (error instanceof UsernameTakenError) {
      return data<UsersActionResult>(
        { error: "usernameTaken", intent: "create-user", ok: false },
        { status: 409 },
      );
    }

    if (
      error instanceof RoleAssignmentDeniedError ||
      error instanceof UserManagementDeniedError
    ) {
      return data<UsersActionResult>(
        { error: "forbidden", intent: "create-user", ok: false },
        { status: 403 },
      );
    }

    throw error;
  }

  return data<UsersActionResult>({ intent: "create-user", ok: true });
}

async function handleSetActive(
  actor: User,
  formData: FormData,
  services: ApplicationServices,
): Promise<ReturnType<typeof data<UsersActionResult>>> {
  const userId = formData.get("userId");
  const isActiveValue = formData.get("isActive");

  if (
    typeof userId !== "string" ||
    (isActiveValue !== "true" && isActiveValue !== "false")
  ) {
    return data<UsersActionResult>(
      { error: "invalidInput", intent: "set-active", ok: false },
      { status: 400 },
    );
  }

  try {
    await services.userService.setActive(
      actor,
      userId,
      isActiveValue === "true",
    );
  } catch (error: unknown) {
    if (error instanceof UserNotFoundError) {
      return data<UsersActionResult>(
        { error: "userNotFound", intent: "set-active", ok: false },
        { status: 404 },
      );
    }

    if (error instanceof LastAdministratorError) {
      return data<UsersActionResult>(
        { error: "lastAdministrator", intent: "set-active", ok: false },
        { status: 409 },
      );
    }

    if (error instanceof UserManagementDeniedError) {
      return data<UsersActionResult>(
        { error: "forbidden", intent: "set-active", ok: false },
        { status: 403 },
      );
    }

    throw error;
  }

  return data<UsersActionResult>({ intent: "set-active", ok: true });
}

function CreateUserDialog({
  assignableRoles,
}: {
  readonly assignableRoles: readonly Role[];
}): React.ReactElement {
  const { t } = useTranslation();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<Role>(ROLE.EMPLOYEE);
  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "create-user";

  useEffect(() => {
    if (actionData?.intent === "create-user" && actionData.ok) {
      setIsOpen(false);
      setSelectedRole(ROLE.EMPLOYEE);
    }
  }, [actionData]);

  useEffect(() => {
    if (isOpen) {
      setSelectedRole(ROLE.EMPLOYEE);
    }
  }, [isOpen]);

  const error =
    actionData?.intent === "create-user" && !actionData.ok
      ? actionData.error
      : null;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>{t("users.create.trigger")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {t("users.create.title")}
        </DialogTitle>

        <Form className="mt-5 flex flex-col gap-3" method="post" noValidate>
          <input name="intent" type="hidden" value="create-user" />
          <input name="role" type="hidden" value={selectedRole} />

          <label
            className="select-none text-sm font-medium text-foreground"
            htmlFor="displayName"
          >
            {t("users.create.name")}
          </label>
          <Input id="displayName" name="displayName" type="text" required />

          <label
            className="select-none text-sm font-medium text-foreground"
            htmlFor="username"
          >
            {t("users.create.username")}
          </label>
          <Input
            id="username"
            name="username"
            type="text"
            autoComplete="off"
            required
          />

          <label
            className="select-none text-sm font-medium text-foreground"
            htmlFor="password"
          >
            {t("users.create.password")}
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={MINIMUM_PASSWORD_LENGTH}
            required
          />

          {assignableRoles.length > 1 ? (
            <>
              <label
                className="select-none text-sm font-medium text-foreground"
                htmlFor="role"
              >
                {t("users.create.role")}
              </label>
              <Select
                id="role"
                ariaLabel={t("users.create.role")}
                value={selectedRole}
                onValueChange={(value) => setSelectedRole(value as Role)}
                className="min-w-36"
                options={assignableRoles.map((role) => ({
                  value: role,
                  label: t(`role.${role}`),
                }))}
              />
            </>
          ) : null}

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {t(`users.error.${error}`)}
            </p>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t("users.create.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? t("users.create.submitting")
                : t("users.create.submit")}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function UserRow({
  user,
}: {
  readonly user: UserListItem;
}): React.ReactElement {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const isTogglingThisUser =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "set-active" &&
    navigation.formData.get("userId") === user.id;

  return (
    <tr className="last:border-0">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <UserAvatar user={user} />
          <span className="text-sm font-medium text-foreground">
            {user.displayName}
          </span>
        </div>
      </td>
      <td className="px-4 py-2.5 text-sm text-muted-foreground">
        {user.username}
      </td>
      <td className="px-4 py-2.5 text-sm text-foreground">
        {t(`role.${user.role}`)}
      </td>
      <td className="px-4 py-2.5 text-sm">
        <span
          className={
            user.isActive ? "text-foreground" : "text-muted-foreground"
          }
        >
          {t(user.isActive ? "users.status.active" : "users.status.inactive")}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right">
        {user.canManage ? (
          <Form method="post">
            <input name="intent" type="hidden" value="set-active" />
            <input name="userId" type="hidden" value={user.id} />
            <input
              name="isActive"
              type="hidden"
              value={user.isActive ? "false" : "true"}
            />
            <Button
              className="min-h-8 px-3 text-xs"
              type="submit"
              variant="ghost"
              disabled={isTogglingThisUser}
            >
              {t(
                user.isActive
                  ? "users.actions.deactivate"
                  : "users.actions.activate",
              )}
            </Button>
          </Form>
        ) : null}
      </td>
    </tr>
  );
}

/** Renders the compact user-management screen. */
export default function UsersRoute(): React.ReactElement {
  const { t } = useTranslation();
  const { users, assignableRoles } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const rowActionError =
    actionData?.intent === "set-active" && !actionData.ok
      ? actionData.error
      : null;

  return (
    <PageContent>
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between gap-4">
          <h1 className="select-none text-2xl font-semibold tracking-tight text-foreground xl:text-xl">
            {t("users.title")}
          </h1>
          <CreateUserDialog assignableRoles={assignableRoles} />
        </div>

        {rowActionError ? (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {t(`users.error.${rowActionError}`)}
          </p>
        ) : null}

        <div className="mt-6 overflow-x-auto rounded-xl bg-surface shadow-xs">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="select-none bg-muted/60 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                <th className="px-4 py-2.5 font-medium">
                  {t("users.columns.user")}
                </th>
                <th className="px-4 py-2.5 font-medium">
                  {t("users.columns.username")}
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
              {users.map((user) => (
                <UserRow key={user.id} user={user} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PageContent>
  );
}
