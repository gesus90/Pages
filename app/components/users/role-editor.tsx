import { useTranslation } from "react-i18next";
import { Form } from "react-router";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Dialog, DialogClose } from "@/app/components/ui/dialog";
import { SidePanelContent } from "@/app/components/ui/side-panel";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";
import { UserField } from "@/app/components/users/user-field";
import { FormError } from "@/app/components/users/form-error";
import { useCloseAfterAction } from "@/app/components/users/use-close-after-action";
import {
  useIsSubmitting,
  useUsersError,
} from "@/app/components/users/use-users-action";
import { CAPABILITY } from "@/definition/Authorization";
import type { AccountAccess, UserRole } from "@/definition/Authorization";

interface RoleEditorProps {
  readonly role: UserRole | null;
  readonly actor: AccountAccess;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** Edits shared role capabilities; personal admin eligibility is deliberately separate. */
export function RoleEditor({
  role,
  actor,
  open,
  onOpenChange,
}: RoleEditorProps): React.ReactElement {
  const { t } = useTranslation();
  const error = useUsersError("save-role");
  const pending = useIsSubmitting("save-role");
  function close(): void {
    onOpenChange(false);
  }
  useCloseAfterAction("save-role", close);
  const admin = actor.isAdmin && actor.mode === "admin";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SidePanelContent
        title={t(role ? "users.catalog.editRole" : "users.catalog.addRole")}
        closeLabel={t("users.reset.close")}
      >
        <Form method="post" className="flex min-h-0 flex-1 flex-col">
          <input type="hidden" name="intent" value="save-role" />
          <input type="hidden" name="entityId" value={role?.id ?? ""} />
          <VerticalScrollArea
            className="min-h-0 flex-1"
            contentClassName="flex flex-col gap-4 px-6 pb-10"
          >
            <UserField
              id="role-name"
              label={t("users.catalog.name")}
              name="name"
              defaultValue={role?.name ?? ""}
              type="text"
              required
            />
            <UserField
              id="role-rank"
              label={t("users.catalog.rank")}
              name="rank"
              defaultValue={role?.rank ?? 0}
              type="number"
              min={0}
              step={1}
              required
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked disabled />
              {t("users.permissions.read")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                name="departmentBound"
                value="true"
                defaultChecked={role?.departmentBound ?? true}
              />
              {t("users.catalog.departmentBound")}
            </label>
            <p className="text-xs text-muted-foreground">
              {t("users.catalog.a3Hint")}
            </p>
            {Object.values(CAPABILITY).map((permission) => (
              <label
                key={permission}
                className="flex items-center gap-2 text-sm"
              >
                <Checkbox
                  name="permission"
                  value={permission}
                  defaultChecked={
                    role?.permissions.includes(permission) ?? false
                  }
                  disabled={
                    !admin &&
                    (permission === CAPABILITY.MANAGE_ROLES ||
                      !actor.role?.permissions.includes(permission))
                  }
                />
                {t(`users.permissions.${permission}`)}
              </label>
            ))}
            <FormError error={error} />
          </VerticalScrollArea>
          <footer className="flex justify-end gap-2 border-t border-border/60 px-6 py-4">
            <DialogClose asChild>
              <Button variant="ghost" data-panel-dismiss>
                {t("users.edit.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" isPending={pending}>
              {t("users.edit.submit")}
            </Button>
          </footer>
        </Form>
      </SidePanelContent>
    </Dialog>
  );
}
