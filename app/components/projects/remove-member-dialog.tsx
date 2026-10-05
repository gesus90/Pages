import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

import type { ProjectMember } from "@/definition/Project";

interface RemoveMemberDialogProps {
  readonly member: ProjectMember | null;
  readonly onClose: () => void;
}

/** Renders the confirmation for removing a member; open while one is chosen. */
export function RemoveMemberDialog({
  member,
  onClose,
}: RemoveMemberDialogProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Dialog open={member !== null} onOpenChange={onClose}>
      <DialogContent className="w-[min(26rem,90vw)]">
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {t("projectDetail.team.removeTitle")}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("projectDetail.team.removeDescription", {
            name: member?.displayName ?? "",
          })}
        </DialogDescription>
        <Form
          className="mt-5 flex justify-end gap-2"
          method="post"
          onSubmit={onClose}
        >
          <input name="intent" type="hidden" value="remove-member" />
          <input name="userId" type="hidden" value={member?.userId ?? ""} />
          <DialogClose asChild>
            <Button variant="ghost">{t("projectDetail.team.cancel")}</Button>
          </DialogClose>
          <Button
            className="bg-destructive text-primary-foreground hover:opacity-90"
            type="submit"
          >
            {t("projectDetail.team.remove")}
          </Button>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
