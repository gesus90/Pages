import { useState } from "react";
import { useSubmit } from "react-router";

import { ChangeRoleDialog } from "@/app/components/users/change-role-dialog";
import { DeactivateDialog } from "@/app/components/users/deactivate-dialog";
import { EditUserDialog } from "@/app/components/users/edit-user-dialog";
import { ResetPasswordDialog } from "@/app/components/users/reset-password-dialog";
import { UserActionsMenu } from "@/app/components/users/user-actions-menu";

import type { Role } from "@/definition/Role";
import type { UserListItem } from "@/definition/User";

interface UserRowActionsProps {
  readonly user: UserListItem;
  readonly assignableRoles: readonly Role[];
}

/** Renders the action menu of a user row together with the dialogs it opens. */
export function UserRowActions({
  user,
  assignableRoles,
}: UserRowActionsProps): React.ReactElement | null {
  const submit = useSubmit();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isRoleOpen, setIsRoleOpen] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);

  if (!user.canManage) {
    return null;
  }

  function handleEdit(): void {
    setIsEditOpen(true);
  }

  function handleChangeRole(): void {
    setIsRoleOpen(true);
  }

  function handleResetPassword(): void {
    setIsResetOpen(true);
  }

  function handleDeactivate(): void {
    setIsDeactivateOpen(true);
  }

  function handleActivate(): void {
    void submit(
      { intent: "set-active", isActive: "true", userId: user.id },
      { method: "post" },
    );
  }

  return (
    <>
      <UserActionsMenu
        onActivate={handleActivate}
        onChangeRole={handleChangeRole}
        onDeactivate={handleDeactivate}
        onEdit={handleEdit}
        onResetPassword={handleResetPassword}
        user={user}
      />

      <EditUserDialog
        user={user}
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
      />
      <ChangeRoleDialog
        user={user}
        assignableRoles={assignableRoles}
        open={isRoleOpen}
        onOpenChange={setIsRoleOpen}
      />
      <ResetPasswordDialog
        user={user}
        open={isResetOpen}
        onOpenChange={setIsResetOpen}
      />
      <DeactivateDialog
        user={user}
        open={isDeactivateOpen}
        onOpenChange={setIsDeactivateOpen}
      />
    </>
  );
}
