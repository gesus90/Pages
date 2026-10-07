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
import { UserField } from "@/app/components/users/user-field";
import { FormError } from "@/app/components/users/form-error";
import { useCloseAfterAction } from "@/app/components/users/use-close-after-action";
import {
  useIsSubmitting,
  useUsersError,
} from "@/app/components/users/use-users-action";
import type { ManagedUser } from "@/definition/Authorization";
import type { ManagedGroup } from "@/definition/UserGroup";

interface GroupEditorProps {
  readonly selected: ManagedGroup | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** People the actor may put into a group. */
  readonly candidates: readonly ManagedUser[];
}

/** Creates or edits a group with its name and at least one member. */
export function GroupEditor({
  selected,
  open,
  onOpenChange,
  candidates,
}: GroupEditorProps): React.ReactElement {
  const { t } = useTranslation();
  const error = useUsersError("save-group");
  const pending = useIsSubmitting("save-group");
  function close(): void {
    onOpenChange(false);
  }
  useCloseAfterAction("save-group", close);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {t(selected ? "users.groups.edit" : "users.groups.add")}
        </DialogTitle>
        <Form method="post" className="mt-5 flex flex-col gap-4">
          <input name="intent" type="hidden" value="save-group" />
          <input name="entityId" type="hidden" value={selected?.id ?? ""} />
          <UserField
            id="group-name"
            name="name"
            label={t("users.catalog.name")}
            defaultValue={selected?.name ?? ""}
            type="text"
            required
          />
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium">
              {t("users.groups.members")}
            </legend>
            <p className="text-xs text-muted-foreground">
              {t("users.groups.membersHint")}
            </p>
            <div className="flex max-h-56 flex-col gap-3 overflow-y-auto">
              {candidates.map((user) => (
                <label
                  key={user.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    name="member"
                    value={user.id}
                    defaultChecked={selected?.memberIds.includes(user.id)}
                  />
                  <span className="pages-selectable">{user.displayName}</span>
                </label>
              ))}
            </div>
            {candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("users.groups.noCandidates")}
              </p>
            ) : null}
          </fieldset>
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
