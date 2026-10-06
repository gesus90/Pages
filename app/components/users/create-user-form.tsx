import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { DialogClose } from "@/app/components/ui/dialog";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { FormError } from "@/app/components/users/form-error";
import { RoleSelect } from "@/app/components/users/role-select";
import { UserField } from "@/app/components/users/user-field";
import { DepartmentChoices } from "@/app/components/users/department-choices";

import type { Department, UserRole } from "@/definition/Authorization";
import type { UsersErrorCode } from "@/app/lib/user-actions/user-action-support.server";

interface CreateUserFormProps {
  readonly departments: readonly Department[];
  readonly roles: readonly UserRole[];
  readonly canCreateAdmin: boolean;
  readonly error: UsersErrorCode | null;
  readonly isSubmitting: boolean;
}

/** Onboarding fields; departmentless creation remains available before adoption. */
export function CreateUserForm({
  roles,
  departments,
  canCreateAdmin,
  error,
  isSubmitting,
}: CreateUserFormProps): React.ReactElement {
  const { t } = useTranslation();
  const [role, setRole] = useState(roles.at(-1)?.id ?? "");
  return (
    <Form className="flex min-h-0 flex-1 flex-col" method="post" noValidate>
      <input type="hidden" name="intent" value="create-user" />
      <input type="hidden" name="role" value={role} />
      <VerticalScrollArea
        className="min-h-0 flex-1"
        contentClassName="flex flex-col gap-4 px-6 pb-10"
      >
        <UserField
          id="firstName"
          name="firstName"
          label={t("users.fields.firstName")}
          type="text"
          required
        />
        <UserField
          id="lastName"
          name="lastName"
          label={t("users.fields.lastName")}
          type="text"
          required
        />
        <UserField
          id="username"
          name="username"
          label={t("users.create.username")}
          type="text"
          autoComplete="off"
          required
        />
        <UserField
          id="create-email"
          name="email"
          label={t("users.create.email")}
          type="email"
        />
        {roles.length > 1 || canCreateAdmin ? (
          <RoleSelect
            id="create-role"
            label={t("users.create.role")}
            className="w-full"
            roles={roles}
            value={role}
            onChange={setRole}
            unassignedLabel={
              canCreateAdmin ? t("users.unassignedRole") : undefined
            }
          />
        ) : (
          <p className="text-sm">{roles[0]?.name ?? t("users.noRoles")}</p>
        )}
        {canCreateAdmin ? (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="isAdmin" value="true" />
            {t("users.personalAdmin")}
          </label>
        ) : null}
        <DepartmentChoices
          departments={departments}
          selected={[]}
          allowed={departments.map((department) => department.id)}
        />
        <FormError error={error} />
      </VerticalScrollArea>
      <footer className="flex justify-end gap-2 border-t border-border/60 px-6 py-4">
        <DialogClose asChild>
          <Button type="button" variant="ghost" data-panel-dismiss>
            {t("users.create.cancel")}
          </Button>
        </DialogClose>
        <Button type="submit" isPending={isSubmitting}>
          {t("users.create.submit")}
        </Button>
      </footer>
    </Form>
  );
}
