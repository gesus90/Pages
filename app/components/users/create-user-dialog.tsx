import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { FormError } from "@/app/components/users/form-error";
import { RoleSelect } from "@/app/components/users/role-select";
import { UserField } from "@/app/components/users/user-field";
import {
  useIsSubmitting,
  useUsersActionData,
  useUsersError,
} from "@/app/components/users/use-users-action";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";
import { ROLE } from "@/definition/Role";
import { MINIMUM_PASSWORD_LENGTH } from "@/definition/User";

import type { Role } from "@/definition/Role";

interface CreateUserDialogProps {
  readonly assignableRoles: readonly Role[];
}

/** Renders the button that opens the dialog for creating a user. */
export function CreateUserDialog({
  assignableRoles,
}: CreateUserDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const actionData = useUsersActionData();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<Role>(ROLE.EMPLOYEE);
  const isSubmitting = useIsSubmitting("create-user");

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

  const error = useUsersError("create-user");

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

          <UserField
            id="displayName"
            label={t("users.create.name")}
            name="displayName"
            type="text"
            required
          />

          <UserField
            id="username"
            label={t("users.create.username")}
            name="username"
            type="text"
            autoComplete="off"
            required
          />

          <UserField
            id="create-email"
            label={t("users.create.email")}
            name="email"
            type="email"
            autoComplete="off"
          />

          <UserField
            id="password"
            label={t("users.create.password")}
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
              <RoleSelect
                className="min-w-36"
                id="role"
                label={t("users.create.role")}
                onChange={setSelectedRole}
                roles={assignableRoles}
                value={selectedRole}
              />
            </>
          ) : null}

          <FormError error={error} />

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
