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
import {
  useIsSubmitting,
  useUsersActionData,
} from "@/app/components/users/use-users-action";

import type { UserListItem } from "@/definition/User";

interface DeactivateDialogProps {
  readonly user: UserListItem;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** Renders the confirmation dialog for deactivating a user. */
export function DeactivateDialog({
  user,
  open,
  onOpenChange,
}: DeactivateDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const actionData = useUsersActionData();
  const isSubmitting = useIsSubmitting("set-active");

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
