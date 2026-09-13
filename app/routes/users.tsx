import { randomUUID } from "node:crypto";

import {
  Check,
  Copy,
  KeyRound,
  MoreHorizontal,
  Pencil,
  Search,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Form,
  data,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";

import { UserAvatar } from "@/app/components/common/user-avatar";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import {
  authenticatedUserContext,
  requirePermission,
} from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  EmailTakenError,
  UsernameTakenError,
} from "@/backend/database/repositories/UserRepository";
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
import type { ChangeEvent } from "react";
import type { ApplicationServices } from "@/app/lib/services.server";
import type { Role } from "@/definition/Role";
import type { User } from "@/definition/User";

const MAXIMUM_NAME_LENGTH = 200;
const MAXIMUM_USERNAME_LENGTH = 200;
const MAXIMUM_EMAIL_LENGTH = 320;
const MINIMUM_PASSWORD_LENGTH = 8;
const MAXIMUM_PASSWORD_LENGTH = 1000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type UsersErrorCode =
  | "usernameTaken"
  | "emailTaken"
  | "invalidInput"
  | "forbidden"
  | "lastAdministrator"
  | "demoteLastAdministrator"
  | "userNotFound";

type UsersIntent =
  "create-user" | "set-active" | "update-user" | "set-role" | "reset-password";

type UsersActionResult =
  | {
      readonly ok: true;
      readonly intent: Exclude<UsersIntent, "reset-password">;
    }
  | {
      readonly ok: true;
      readonly intent: "reset-password";
      readonly userId: string;
      readonly temporaryPassword: string;
    }
  | {
      readonly ok: false;
      readonly intent: UsersIntent;
      readonly error: UsersErrorCode;
    };

interface UserListItem extends User {
  readonly canManage: boolean;
  readonly email: string | null;
}

interface UsersLoaderData {
  readonly users: readonly UserListItem[];
  readonly assignableRoles: readonly Role[];
}

interface CreateUserInput {
  readonly displayName: string;
  readonly username: string;
  readonly email: string | null;
  readonly password: string;
  readonly role: Role;
}

interface UpdateUserInput {
  readonly userId: string;
  readonly displayName: string;
  readonly username: string;
  readonly email: string | null;
}

/** Restricts a leaf route to users allowed to view the user directory. */
export const middleware: MiddlewareFunction[] = [
  requirePermission(PERMISSION.VIEW_USERS),
];

/** Loads the user directory with email addresses for the management table. */
export async function loader({
  context,
}: LoaderFunctionArgs): Promise<UsersLoaderData> {
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

function getTrimmedString(formData: FormData, key: string): string {
  const value = formData.get(key);

  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(formData: FormData, key: string): string | null {
  const trimmed = getTrimmedString(formData, key);

  return trimmed === "" ? null : trimmed;
}

function isValidEmail(email: string): boolean {
  return email.length <= MAXIMUM_EMAIL_LENGTH && EMAIL_PATTERN.test(email);
}

function matchesSearch(user: UserListItem, query: string): boolean {
  if (query === "") {
    return true;
  }

  return [user.displayName, user.username, user.email ?? ""].some((value) =>
    value.toLowerCase().includes(query),
  );
}

function toActionError(
  error: unknown,
  intent: UsersIntent,
): ReturnType<typeof data<UsersActionResult>> {
  if (error instanceof UserNotFoundError) {
    return data<UsersActionResult>(
      { error: "userNotFound", intent, ok: false },
      { status: 404 },
    );
  }

  if (error instanceof LastAdministratorError) {
    return data<UsersActionResult>(
      {
        error:
          intent === "set-role"
            ? "demoteLastAdministrator"
            : "lastAdministrator",
        intent,
        ok: false,
      },
      { status: 409 },
    );
  }

  if (
    error instanceof RoleAssignmentDeniedError ||
    error instanceof UserManagementDeniedError
  ) {
    return data<UsersActionResult>(
      { error: "forbidden", intent, ok: false },
      { status: 403 },
    );
  }

  if (error instanceof UsernameTakenError) {
    return data<UsersActionResult>(
      { error: "usernameTaken", intent, ok: false },
      { status: 409 },
    );
  }

  if (error instanceof EmailTakenError) {
    return data<UsersActionResult>(
      { error: "emailTaken", intent, ok: false },
      { status: 409 },
    );
  }

  throw error;
}

/** Creates users and applies directory mutations for authorized actors. */
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

  if (intent === "update-user") {
    return handleUpdateUser(actor, formData, services);
  }

  if (intent === "set-role") {
    return handleSetRole(actor, formData, services);
  }

  if (intent === "reset-password") {
    return handleResetPassword(actor, formData, services);
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
  const email = normalizeEmail(formData, "email");

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

  if (email !== null && !isValidEmail(email)) {
    return null;
  }

  const role =
    actorRole === ROLE.ADMIN && isRole(requestedRole)
      ? requestedRole
      : ROLE.EMPLOYEE;

  return {
    displayName: trimmedDisplayName,
    email,
    password,
    role,
    username: trimmedUsername,
  };
}

function parseUpdateUserInput(formData: FormData): UpdateUserInput | null {
  const userId = formData.get("userId");

  if (typeof userId !== "string" || userId.trim() === "") {
    return null;
  }

  const displayName = getTrimmedString(formData, "displayName");
  const username = getTrimmedString(formData, "username");
  const email = normalizeEmail(formData, "email");

  if (!displayName || !username) {
    return null;
  }

  if (
    displayName.length > MAXIMUM_NAME_LENGTH ||
    username.length > MAXIMUM_USERNAME_LENGTH
  ) {
    return null;
  }

  if (email !== null && !isValidEmail(email)) {
    return null;
  }

  return { displayName, email, userId, username };
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
      email: input.email,
      id: randomUUID(),
      passwordHash,
      role: input.role,
      username: input.username,
    });
  } catch (error: unknown) {
    return toActionError(error, "create-user");
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
    return toActionError(error, "set-active");
  }

  return data<UsersActionResult>({ intent: "set-active", ok: true });
}

async function handleUpdateUser(
  actor: User,
  formData: FormData,
  services: ApplicationServices,
): Promise<ReturnType<typeof data<UsersActionResult>>> {
  const input = parseUpdateUserInput(formData);

  if (!input) {
    return data<UsersActionResult>(
      { error: "invalidInput", intent: "update-user", ok: false },
      { status: 400 },
    );
  }

  try {
    await services.userService.updateUser(actor, input.userId, {
      displayName: input.displayName,
      email: input.email,
      username: input.username,
    });
  } catch (error: unknown) {
    return toActionError(error, "update-user");
  }

  return data<UsersActionResult>({ intent: "update-user", ok: true });
}

async function handleSetRole(
  actor: User,
  formData: FormData,
  services: ApplicationServices,
): Promise<ReturnType<typeof data<UsersActionResult>>> {
  const userId = formData.get("userId");
  const role = formData.get("role");

  if (typeof userId !== "string" || userId.trim() === "" || !isRole(role)) {
    return data<UsersActionResult>(
      { error: "invalidInput", intent: "set-role", ok: false },
      { status: 400 },
    );
  }

  try {
    await services.userService.setRole(actor, userId, role);
  } catch (error: unknown) {
    return toActionError(error, "set-role");
  }

  return data<UsersActionResult>({ intent: "set-role", ok: true });
}

async function handleResetPassword(
  actor: User,
  formData: FormData,
  services: ApplicationServices,
): Promise<ReturnType<typeof data<UsersActionResult>>> {
  const userId = formData.get("userId");

  if (typeof userId !== "string" || userId.trim() === "") {
    return data<UsersActionResult>(
      { error: "invalidInput", intent: "reset-password", ok: false },
      { status: 400 },
    );
  }

  try {
    const { temporaryPassword } = await services.userService.resetPassword(
      actor,
      userId,
      services.passwordHasher,
    );

    return data<UsersActionResult>({
      intent: "reset-password",
      ok: true,
      temporaryPassword,
      userId,
    });
  } catch (error: unknown) {
    return toActionError(error, "reset-password");
  }
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
            htmlFor="create-email"
          >
            {t("users.create.email")}
          </label>
          <Input
            id="create-email"
            name="email"
            type="email"
            autoComplete="off"
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

function EditUserDialog({
  user,
  open,
  onOpenChange,
}: {
  readonly user: UserListItem;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "update-user";

  useEffect(() => {
    if (actionData?.intent === "update-user" && actionData.ok) {
      onOpenChange(false);
    }
  }, [actionData, onOpenChange]);

  const error =
    actionData?.intent === "update-user" && !actionData.ok
      ? actionData.error
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {t("users.edit.title")}
        </DialogTitle>

        <Form className="mt-5 flex flex-col gap-3" method="post" noValidate>
          <input name="intent" type="hidden" value="update-user" />
          <input name="userId" type="hidden" value={user.id} />

          <label
            className="select-none text-sm font-medium text-foreground"
            htmlFor={`edit-name-${user.id}`}
          >
            {t("users.edit.name")}
          </label>
          <Input
            id={`edit-name-${user.id}`}
            name="displayName"
            type="text"
            defaultValue={user.displayName}
            required
          />

          <label
            className="select-none text-sm font-medium text-foreground"
            htmlFor={`edit-username-${user.id}`}
          >
            {t("users.edit.username")}
          </label>
          <Input
            id={`edit-username-${user.id}`}
            name="username"
            type="text"
            autoComplete="off"
            defaultValue={user.username}
            required
          />

          <label
            className="select-none text-sm font-medium text-foreground"
            htmlFor={`edit-email-${user.id}`}
          >
            {t("users.edit.email")}
          </label>
          <Input
            id={`edit-email-${user.id}`}
            name="email"
            type="email"
            autoComplete="off"
            defaultValue={user.email ?? ""}
          />

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {t(`users.error.${error}`)}
            </p>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t("users.edit.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? t("users.edit.submitting")
                : t("users.edit.submit")}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ChangeRoleDialog({
  user,
  assignableRoles,
  open,
  onOpenChange,
}: {
  readonly user: UserListItem;
  readonly assignableRoles: readonly Role[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [selectedRole, setSelectedRole] = useState<Role>(user.role);
  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "set-role";

  useEffect(() => {
    if (open) {
      setSelectedRole(user.role);
    }
  }, [open, user.role]);

  useEffect(() => {
    if (actionData?.intent === "set-role" && actionData.ok) {
      onOpenChange(false);
    }
  }, [actionData, onOpenChange]);

  const error =
    actionData?.intent === "set-role" && !actionData.ok
      ? actionData.error
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {t("users.changeRole.title")}
        </DialogTitle>

        <Form className="mt-5 flex flex-col gap-3" method="post" noValidate>
          <input name="intent" type="hidden" value="set-role" />
          <input name="userId" type="hidden" value={user.id} />
          <input name="role" type="hidden" value={selectedRole} />

          <span className="select-none text-sm font-medium text-foreground">
            {t("users.changeRole.role")}
          </span>
          <Select
            id={`change-role-${user.id}`}
            ariaLabel={t("users.changeRole.role")}
            value={selectedRole}
            onValueChange={(value) => setSelectedRole(value as Role)}
            className="w-full"
            options={assignableRoles.map((role) => ({
              value: role,
              label: t(`role.${role}`),
            }))}
          />

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {t(`users.error.${error}`)}
            </p>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t("users.changeRole.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? t("users.changeRole.submitting")
                : t("users.changeRole.submit")}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function CopyButton({ value }: { readonly value: string }): React.ReactElement {
  const { t } = useTranslation();
  const [isCopied, setIsCopied] = useState(false);

  function handleCopy(): void {
    if (!navigator.clipboard) {
      return;
    }

    navigator.clipboard
      .writeText(value)
      .then(() => {
        setIsCopied(true);
      })
      .catch(() => {
        setIsCopied(false);
      });
  }

  useEffect(() => {
    if (!isCopied) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setIsCopied(false);
    }, 2000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [isCopied]);

  return (
    <Button
      className="h-9 shrink-0 gap-1.5 px-3 text-xs"
      onClick={handleCopy}
      type="button"
      variant="outline"
    >
      {isCopied ? (
        <Check className="size-4 text-emerald-600" aria-hidden="true" />
      ) : (
        <Copy className="size-4" aria-hidden="true" />
      )}
      {isCopied ? t("users.reset.copied") : t("users.reset.copy")}
    </Button>
  );
}

function ResetPasswordDialog({
  user,
  open,
  onOpenChange,
}: {
  readonly user: UserListItem;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [showsResult, setShowsResult] = useState(false);
  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "reset-password";

  const temporaryPassword =
    actionData?.intent === "reset-password" &&
    actionData.ok &&
    actionData.userId === user.id
      ? actionData.temporaryPassword
      : null;

  useEffect(() => {
    if (temporaryPassword) {
      setShowsResult(true);
    }
  }, [temporaryPassword]);

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen) {
      setShowsResult(false);
    }

    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {showsResult ? t("users.reset.resultTitle") : t("users.reset.title")}
        </DialogTitle>

        {showsResult && temporaryPassword ? (
          <div className="mt-5 flex flex-col gap-3">
            <label
              className="select-none text-sm font-medium text-foreground"
              htmlFor={`temporary-password-${user.id}`}
            >
              {t("users.reset.temporaryPassword")}
            </label>
            <div className="flex items-center gap-2">
              <p
                id={`temporary-password-${user.id}`}
                className="min-w-0 flex-1 truncate rounded-xl bg-muted px-4 py-3 font-mono text-sm font-semibold text-foreground"
              >
                {temporaryPassword}
              </p>
              <CopyButton value={temporaryPassword} />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("users.reset.emailHint")}
            </p>
            <div className="mt-2 flex justify-end">
              <DialogClose asChild>
                <Button type="button">{t("users.reset.close")}</Button>
              </DialogClose>
            </div>
          </div>
        ) : (
          <Form className="mt-5 flex flex-col gap-3" method="post">
            <input name="intent" type="hidden" value="reset-password" />
            <input name="userId" type="hidden" value={user.id} />

            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("users.reset.text")}
            </p>

            <div className="mt-2 flex justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  {t("users.reset.cancel")}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? t("users.reset.resetting")
                  : t("users.reset.confirm")}
              </Button>
            </div>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeactivateDialog({
  user,
  open,
  onOpenChange,
}: {
  readonly user: UserListItem;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "set-active";

  useEffect(() => {
    if (actionData?.intent === "set-active" && actionData.ok) {
      onOpenChange(false);
    }
  }, [actionData, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {t("users.deactivate.title")}
        </DialogTitle>

        <Form className="mt-5 flex flex-col gap-3" method="post">
          <input name="intent" type="hidden" value="set-active" />
          <input name="userId" type="hidden" value={user.id} />
          <input name="isActive" type="hidden" value="false" />

          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("users.deactivate.text")}
          </p>

          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t("users.deactivate.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {isSubmitting
                ? t("users.deactivate.deactivating")
                : t("users.deactivate.confirm")}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function UserRowActions({
  user,
  assignableRoles,
}: {
  readonly user: UserListItem;
  readonly assignableRoles: readonly Role[];
}): React.ReactElement | null {
  const { t } = useTranslation();
  const submit = useSubmit();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isRoleOpen, setIsRoleOpen] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);

  if (!user.canManage) {
    return null;
  }

  function handleEdit(): void {
    setIsEditOpen(true);
  }

  function handleChangeRole(): void {
    setIsRoleOpen(true);
  }

  function handleResetPassword(): void {
    setIsResetOpen(true);
  }

  function handleDeactivate(): void {
    setIsDeactivateOpen(true);
  }

  function handleActivate(): void {
    submit(
      { intent: "set-active", isActive: "true", userId: user.id },
      { method: "post" },
    );
  }

  return (
    <>
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
          <DropdownMenuItem className="gap-2.5" onSelect={handleEdit}>
            <Pencil
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            {t("users.menu.edit")}
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2.5" onSelect={handleChangeRole}>
            <ShieldCheck
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            {t("users.menu.changeRole")}
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2.5" onSelect={handleResetPassword}>
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
              onSelect={handleDeactivate}
            >
              <TriangleAlert className="size-4" aria-hidden="true" />
              {t("users.actions.deactivate")}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem className="gap-2.5" onSelect={handleActivate}>
              <Check
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              {t("users.actions.activate")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <EditUserDialog
        user={user}
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
      />
      <ChangeRoleDialog
        user={user}
        assignableRoles={assignableRoles}
        open={isRoleOpen}
        onOpenChange={setIsRoleOpen}
      />
      <ResetPasswordDialog
        user={user}
        open={isResetOpen}
        onOpenChange={setIsResetOpen}
      />
      <DeactivateDialog
        user={user}
        open={isDeactivateOpen}
        onOpenChange={setIsDeactivateOpen}
      />
    </>
  );
}

function UserRow({
  user,
  assignableRoles,
}: {
  readonly user: UserListItem;
  readonly assignableRoles: readonly Role[];
}): React.ReactElement {
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
/** Renders the open, table-first user-management screen. */
export default function UsersRoute(): React.ReactElement {
  const { t } = useTranslation();
  const { users, assignableRoles } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [search, setSearch] = useState("");
  const rowActionError = actionData && !actionData.ok ? actionData.error : null;
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
