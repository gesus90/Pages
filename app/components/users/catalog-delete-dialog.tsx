import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";
import { FormError } from "@/app/components/users/form-error";
import { useCloseAfterAction } from "@/app/components/users/use-close-after-action";
import {
  useIsSubmitting,
  useUsersError,
} from "@/app/components/users/use-users-action";

interface CatalogDeleteDialogProps {
  readonly id: string;
  readonly name: string;
  readonly kind: "role" | "department" | "group";
  readonly disabled: boolean;
}

/** Requires explicit confirmation and explains what deleting the entry leaves behind. */
export function CatalogDeleteDialog({
  id,
  name,
  kind,
  disabled,
}: CatalogDeleteDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const intent = `delete-${kind}` as const;
  const error = useUsersError(intent);
  const pending = useIsSubmitting(intent);
  function close(): void {
    setOpen(false);
  }
  useCloseAfterAction(intent, close);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={t("users.catalog.deleteNamed", { name })}
        >
          {t("users.catalog.delete")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {t("users.catalog.deleteNamed", { name })}
        </DialogTitle>
        <p className="mt-3 text-sm text-muted-foreground">
          {t(`users.catalog.${kind}DeleteHint`)}
        </p>
        <Form className="mt-5" method="post">
          <input type="hidden" name="intent" value={intent} />
          <input type="hidden" name="entityId" value={id} />
          <FormError error={error} />
          <footer className="mt-6 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">{t("users.edit.cancel")}</Button>
            </DialogClose>
            <Button type="submit" variant="destructive" isPending={pending}>
              {t("users.catalog.delete")}
            </Button>
          </footer>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
