import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { FormError } from "@/app/components/users/form-error";
import { RoleSelect } from "@/app/components/users/role-select";
import {
  useIsSubmitting,
  useUsersActionData,
  useUsersError,
} from "@/app/components/users/use-users-action";

import type { Role } from "@/definition/Role";
import type { UserListItem } from "@/definition/User";

interface ChangeRoleDialogProps {
  readonly user: UserListItem;
  readonly assignableRoles: readonly Role[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** Renders the dialog for assigning another role to a user. */
export function ChangeRoleDialog({
  user,
  assignableRoles,
  open,
  onOpenChange,
}: ChangeRoleDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const actionData = useUsersActionData();
  const [selectedRole, setSelectedRole] = useState<Role>(user.role);
  const isSubmitting = useIsSubmitting("set-role");

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

  const error = useUsersError("set-role");

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
          <RoleSelect
            className="w-full"
            id={`change-role-${user.id}`}
            label={t("users.changeRole.role")}
            onChange={setSelectedRole}
            roles={assignableRoles}
            value={selectedRole}
          />

          <FormError error={error} />

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
