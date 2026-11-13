import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { CreateUserForm } from "@/app/components/users/create-user-form";
import { TemporaryPasswordResult } from "@/app/components/users/temporary-password-result";
import {
  useIsSubmitting,
  useUsersActionData,
  useUsersError,
} from "@/app/components/users/use-users-action";
import { Button } from "@/app/components/ui/button";
import { Dialog, DialogTrigger } from "@/app/components/ui/dialog";
import { SidePanelContent } from "@/app/components/ui/side-panel";

import type { Department, UserRole } from "@/definition/Authorization";

interface CreateUserDialogProps {
  readonly departments: readonly Department[];
  readonly assignableRoles: readonly UserRole[];
  readonly canCreateAdmin: boolean;
  readonly isManagement?: boolean;
}

/** Opens the onboarding side panel and retains the password only until dismissal. */
export function CreateUserDialog({
  assignableRoles,
  canCreateAdmin,
  isManagement = false,
  departments,
}: CreateUserDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const actionData = useUsersActionData();
  const [isOpen, setIsOpen] = useState(false);
  const [invitationSent, setInvitationSent] = useState(false);
  const [shownPassword, setShownPassword] = useState<string | null>(null);
  const isSubmitting = useIsSubmitting("create-user");
  const error = useUsersError("create-user");
  useEffect(() => {
    if (actionData?.intent === "create-user" && actionData.ok) {
      setShownPassword(actionData.temporaryPassword ?? null);
      setInvitationSent(actionData.invitationSent === true);
    }
  }, [actionData]);

  function handleOpenChange(open: boolean): void {
    setShownPassword(null);
    setInvitationSent(false);
    setIsOpen(open);
  }
  function handleClose(): void {
    handleOpenChange(false);
  }
  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" aria-hidden="true" />
          {t("users.create.trigger")}
        </Button>
      </DialogTrigger>
      <SidePanelContent
        title={t("users.create.title")}
        closeLabel={t("users.reset.close")}
      >
        {invitationSent ? (
          <p className="p-6 text-sm text-foreground" role="status">
            {t("users.management.invitationSent")}
          </p>
        ) : null}
        {shownPassword ? (
          <div className="px-6">
            <TemporaryPasswordResult
              password={shownPassword}
              onClose={handleClose}
            />
          </div>
        ) : (
          <CreateUserForm
            roles={assignableRoles}
            isManagement={isManagement}
            departments={departments}
            canCreateAdmin={canCreateAdmin}
            isSubmitting={isSubmitting}
            error={error}
          />
        )}
      </SidePanelContent>
    </Dialog>
  );
}
