import { useTranslation } from "react-i18next";
import { Form } from "react-router";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { DepartmentChoices } from "@/app/components/users/department-choices";
import { FormError } from "@/app/components/users/form-error";
import { useCloseAfterAction } from "@/app/components/users/use-close-after-action";
import {
  useIsSubmitting,
  useUsersError,
} from "@/app/components/users/use-users-action";

import type {
  AdministrationPageData,
  ManagedUser,
} from "@/definition/Authorization";

/** The independent administrative operations on an account's access. */
export type UserAccessDialogKind = "memberships" | "scope" | "admin";
const INTENTS = {
  memberships: "set-memberships",
  scope: "set-scope",
  admin: "set-admin",
} as const;

interface UserAccessDialogProps {
  readonly user: ManagedUser;
  readonly directory: AdministrationPageData;
  readonly kind: UserAccessDialogKind | null;
  readonly onClose: () => void;
}

/** Edits membership, personal scopes or admin eligibility as separate server actions. */
export function UserAccessDialog({
  user,
  directory,
  kind,
  onClose,
}: UserAccessDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const intent = INTENTS[kind ?? "memberships"];
  const error = useUsersError(intent);
  const pending = useIsSubmitting(intent);
  useCloseAfterAction(intent, onClose);
  const allowed =
    user.account.departments.length === 0
      ? directory.adoptableDepartmentIds
      : directory.manageableDepartmentIds;
  return (
    <Dialog open={kind !== null} onOpenChange={onClose}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {t(`users.access.${kind ?? "memberships"}`)}
        </DialogTitle>
        <Form method="post" className="mt-5 flex flex-col gap-4">
          <input type="hidden" name="intent" value={intent} />
          <input type="hidden" name="userId" value={user.id} />
          {kind === "memberships" ? (
            <DepartmentChoices
              departments={directory.departments}
              selected={user.account.departments}
              allowed={allowed}
            />
          ) : null}
          {kind === "scope" ? (
            <>
              <DepartmentChoices
                departments={directory.departments}
                selected={user.account.managedDepartments}
                allowed={directory.departments.map(
                  (department) => department.id,
                )}
              />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  name="allDepartments"
                  value="true"
                  defaultChecked={user.account.allDepartments}
                />
                {t("users.allDepartments")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  name="allProjects"
                  value="true"
                  defaultChecked={user.account.allProjects}
                />
                {t("users.allProjects")}
              </label>
            </>
          ) : null}
          {kind === "admin" ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                name="isAdmin"
                value="true"
                defaultChecked={user.account.isAdmin}
              />
              {t("users.personalAdmin")}
            </label>
          ) : null}
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
