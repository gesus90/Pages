import {
  Crown,
  EllipsisVertical,
  Pencil,
  Send,
  Trash2,
  User as UserIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { PROJECT_ROLE } from "@/definition/Project";

import type { ProjectMember, ProjectRole } from "@/definition/Project";

interface RemoveItemProps {
  readonly label: string;
  readonly disabled?: boolean;
  readonly title?: string;
  readonly onRemove: () => void;
}

function RemoveItem({
  label,
  disabled = false,
  title,
  onRemove,
}: RemoveItemProps): React.ReactElement {
  return (
    <DropdownMenuItem
      className="text-destructive"
      disabled={disabled}
      onSelect={onRemove}
      title={title}
    >
      <Trash2 className="mr-2 size-4 shrink-0" aria-hidden="true" />
      {label}
    </DropdownMenuItem>
  );
}

interface TeamMemberMenuProps {
  readonly member: ProjectMember;
  readonly role: ProjectRole;
  readonly isLastManager: boolean;
  readonly onChangeRole: () => void;
  readonly onSetAsManager: () => void;
  readonly onRemove: () => void;
}

/** Renders the actions menu of a team member, depending on their status. */
export function TeamMemberMenu({
  member,
  role,
  isLastManager,
  onChangeRole,
  onSetAsManager,
  onRemove,
}: TeamMemberMenuProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="size-9 min-h-0 px-0"
          variant="ghost"
          aria-label={t("projectDetail.team.actionsFor", {
            name: member.displayName,
          })}
        >
          <EllipsisVertical className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {member.isActive === false ? (
          <>
            <DropdownMenuItem disabled>
              <Send className="mr-2 size-4 shrink-0" aria-hidden="true" />
              {t("projectDetail.team.resendInvitation")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <RemoveItem
              label={t("projectDetail.team.withdrawInvitation")}
              onRemove={onRemove}
            />
          </>
        ) : (
          <>
            <DropdownMenuItem disabled>
              <UserIcon className="mr-2 size-4 shrink-0" aria-hidden="true" />
              {t("projectDetail.team.viewProfile")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onChangeRole}>
              <Pencil className="mr-2 size-4 shrink-0" aria-hidden="true" />
              {t("projectDetail.team.changeRole")}
            </DropdownMenuItem>
            {role !== PROJECT_ROLE.MANAGER ? (
              <DropdownMenuItem onSelect={onSetAsManager}>
                <Crown
                  className="mr-2 size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                {t("projectDetail.team.setAsManager")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <RemoveItem
              disabled={isLastManager}
              label={t("projectDetail.team.removeMember")}
              onRemove={onRemove}
              title={
                isLastManager
                  ? t("projectDetail.team.lastManagerHint")
                  : undefined
              }
            />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
