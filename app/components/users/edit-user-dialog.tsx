import { useEffect } from "react";
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
import { UserField } from "@/app/components/users/user-field";
import {
  useIsSubmitting,
  useUsersActionData,
  useUsersError,
} from "@/app/components/users/use-users-action";

import type { ManagedUser } from "@/definition/Authorization";

interface EditUserDialogProps {
  readonly user: ManagedUser;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** Renders the dialog for editing name, username and email of a user. */
export function EditUserDialog({
  user,
  open,
  onOpenChange,
}: EditUserDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const actionData = useUsersActionData();
  const isSubmitting = useIsSubmitting("update-user");

  useEffect(() => {
    if (actionData?.intent === "update-user" && actionData.ok) {
      onOpenChange(false);
    }
  }, [actionData, onOpenChange]);

  const error = useUsersError("update-user");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold text-foreground">
          {t("users.edit.title")}
        </DialogTitle>

        <Form className="mt-5 flex flex-col gap-3" method="post" noValidate>
          <input name="intent" type="hidden" value="update-user" />
          <input name="userId" type="hidden" value={user.id} />

          <UserField
            id={`edit-name-${user.id}`}
            label={t("users.fields.firstName")}
            name="firstName"
            type="text"
            defaultValue={user.account.firstName}
            required
          />

          <UserField
            id={`edit-last-name-${user.id}`}
            label={t("users.fields.lastName")}
            name="lastName"
            type="text"
            defaultValue={user.account.lastName}
          />

          <UserField
            id={`edit-username-${user.id}`}
            label={t("users.edit.username")}
            name="username"
            type="text"
            autoComplete="off"
            defaultValue={user.username}
            required
          />

          <UserField
            id={`edit-email-${user.id}`}
            label={t("users.edit.email")}
            name="email"
            type="email"
            autoComplete="off"
            defaultValue={user.email ?? ""}
          />

          <FormError error={error} />

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
