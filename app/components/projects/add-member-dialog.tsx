import { UserPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { TeamRoleSelect } from "@/app/components/projects/team-role-select";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";
import { Select } from "@/app/components/ui/select";
import { PROJECT_ROLE } from "@/definition/Project";

import type { ProjectRole } from "@/definition/Project";
import type { User } from "@/definition/User";

interface AddMemberDialogProps {
  readonly eligibleUsers: readonly User[];
}

/** Renders the dialog for adding an eligible user with an initial role. */
export function AddMemberDialog({
  eligibleUsers,
}: AddMemberDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedRole, setSelectedRole] = useState<ProjectRole>(
    PROJECT_ROLE.MEMBER,
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="size-4" aria-hidden="true" />
          {t("projectDetail.team.addMember")}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(26rem,90vw)]">
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {t("projectDetail.team.addMember")}
        </DialogTitle>
        <Form className="mt-5 flex flex-col gap-3" method="post" noValidate>
          <input name="intent" type="hidden" value="add-member" />
          <input name="role" type="hidden" value={selectedRole} />
          <input name="userId" type="hidden" value={selectedUserId} />
          <label
            className="select-none text-sm font-medium"
            htmlFor="add-member-user"
          >
            {t("projectDetail.team.addMember")}
          </label>
          <Select
            id="add-member-user"
            ariaLabel={t("projectDetail.team.addMember")}
            value={selectedUserId}
            onValueChange={setSelectedUserId}
            className="w-full"
            options={[
              { value: "", label: t("projectDetail.team.selectPerson") },
              ...eligibleUsers.map((user) => ({
                value: user.id,
                label: user.displayName,
              })),
            ]}
          />
          <label
            className="select-none text-sm font-medium"
            htmlFor="add-member-role"
          >
            {t("projectDetail.team.role")}
          </label>
          <TeamRoleSelect
            className="w-full"
            id="add-member-role"
            onChange={setSelectedRole}
            value={selectedRole}
          />
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">{t("projectDetail.team.cancel")}</Button>
            </DialogClose>
            <Button type="submit" disabled={!selectedUserId}>
              {t("projectDetail.team.add")}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
