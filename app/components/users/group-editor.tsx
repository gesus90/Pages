import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { GroupMemberFields } from "@/app/components/users/group-member-fields";
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
  /** Whether the actor marks leaders: administrators only (PAGE-308). */
  readonly canSetLeaders: boolean;
}

/** Creates or edits a group with its name, at least one member and its leaders. */
export function GroupEditor({
  selected,
  open,
  onOpenChange,
  candidates,
  canSetLeaders,
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
          <GroupMemberFields
            selected={selected}
            candidates={candidates}
            canSetLeaders={canSetLeaders}
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
