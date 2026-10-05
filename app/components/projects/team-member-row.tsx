import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import { UserAvatar } from "@/app/components/common/user-avatar";
import {
  RoleIcon,
  TeamRoleSelect,
} from "@/app/components/projects/team-role-select";
import { TeamMemberMenu } from "@/app/components/projects/team-member-menu";
import { formatJoinedAt } from "@/app/lib/team-members";
import { PROJECT_ROLE } from "@/definition/Project";

import type { ProjectMember, ProjectRole } from "@/definition/Project";

interface TeamMemberRowProps {
  readonly member: ProjectMember;
  readonly canWrite: boolean;
  readonly isLastManager: boolean;
  readonly onRemove: (member: ProjectMember) => void;
}

/** Renders one team member with inline role management and actions. */
export function TeamMemberRow({
  member,
  canWrite,
  isLastManager,
  onRemove,
}: TeamMemberRowProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const [role, setRole] = useState<ProjectRole>(member.projectRole);
  const joinedAt = formatJoinedAt(member.joinedAt);

  function submitRole(nextRole: ProjectRole): void {
    setRole(nextRole);
    void submit(
      { intent: "update-member-role", role: nextRole, userId: member.userId },
      { method: "post" },
    );
  }

  function handleChangeRole(): void {
    requestAnimationFrame(() => {
      document.getElementById(`role-${member.userId}`)?.focus();
    });
  }

  function handleSetAsManager(): void {
    submitRole(PROJECT_ROLE.MANAGER);
  }

  function handleRemove(): void {
    onRemove(member);
  }

  return (
    <tr className="transition-colors hover:bg-muted/40">
      <td className="py-3 pr-2 pl-4 align-middle">
        <span className="flex items-center gap-3">
          <UserAvatar user={member} />
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="min-w-0 truncate text-sm font-medium text-foreground"
              title={member.displayName}
            >
              {member.displayName}
            </span>
            {member.isActive === false ? (
              <span className="shrink-0 rounded-full bg-slate-500/10 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-slate-500">
                {t("projectDetail.team.invited")}
              </span>
            ) : null}
          </span>
        </span>
      </td>
      <td className="px-3 py-3 align-middle text-sm whitespace-nowrap text-muted-foreground">
        <span className="block truncate" title={member.username}>
          {member.username}
        </span>
      </td>
      <td className="px-3 py-3 align-middle">
        {canWrite ? (
          <TeamRoleSelect
            className="w-[190px] max-w-full"
            id={`role-${member.userId}`}
            onChange={submitRole}
            value={role}
          />
        ) : (
          <span className="inline-flex items-center gap-2 text-sm text-foreground">
            <RoleIcon role={member.projectRole} />
            {t(`projectDetail.team.${member.projectRole}`)}
          </span>
        )}
      </td>
      <td className="px-3 py-3 align-middle text-sm whitespace-nowrap text-muted-foreground">
        <span className="block truncate" title={joinedAt}>
          {joinedAt}
        </span>
      </td>
      <td className="px-3 py-3 text-center align-middle">
        {canWrite ? (
          <TeamMemberMenu
            isLastManager={isLastManager}
            member={member}
            onChangeRole={handleChangeRole}
            onRemove={handleRemove}
            onSetAsManager={handleSetAsManager}
            role={role}
          />
        ) : null}
      </td>
    </tr>
  );
}
