import { useTranslation } from "react-i18next";
import { Form } from "react-router";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { UserField } from "@/app/components/users/user-field";
import { FormError } from "@/app/components/users/form-error";
import { useCloseAfterAction } from "@/app/components/users/use-close-after-action";
import {
  useIsSubmitting,
  useUsersError,
} from "@/app/components/users/use-users-action";
import type { Department } from "@/definition/Authorization";

interface DepartmentEditorProps {
  readonly selected: Department | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** Edits a department label, keeping save failures beside its input. */
export function DepartmentEditor({
  selected,
  open,
  onOpenChange,
}: DepartmentEditorProps): React.ReactElement {
  const { t } = useTranslation();
  const error = useUsersError("save-department");
  const pending = useIsSubmitting("save-department");
  function close(): void {
    onOpenChange(false);
  }
  useCloseAfterAction("save-department", close);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {t(
            selected
              ? "users.catalog.editDepartment"
              : "users.catalog.addDepartment",
          )}
        </DialogTitle>
        <Form method="post" className="mt-5 flex flex-col gap-4">
          <input name="intent" type="hidden" value="save-department" />
          <input name="entityId" type="hidden" value={selected?.id ?? ""} />
          <UserField
            id="department-name"
            name="name"
            label={t("users.catalog.name")}
            defaultValue={selected?.name ?? ""}
            type="text"
            required
          />
          <FormError error={error} />
          <footer className="mt-6 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">{t("users.edit.cancel")}</Button>
            </DialogClose>
            <Button type="submit" isPending={pending}>
              {t("users.edit.submit")}
            </Button>
          </footer>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
