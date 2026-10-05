import { useTranslation } from "react-i18next";

import { TeamMemberRow } from "@/app/components/projects/team-member-row";
import { TeamSortHeader } from "@/app/components/projects/team-sort-header";
import { PROJECT_ROLE } from "@/definition/Project";

import type { SortDirection, TeamSortField } from "@/app/lib/team-members";
import type { ProjectMember } from "@/definition/Project";

interface TeamMemberTableProps {
  readonly members: readonly ProjectMember[];
  readonly managerCount: number;
  readonly canWrite: boolean;
  readonly sortField: TeamSortField;
  readonly sortDirection: SortDirection;
  readonly onSort: (field: TeamSortField) => void;
  readonly onRemove: (member: ProjectMember) => void;
}

/** Renders the sortable table of the visible team members. */
export function TeamMemberTable({
  members,
  managerCount,
  canWrite,
  sortField,
  sortDirection,
  onSort,
  onRemove,
}: TeamMemberTableProps): React.ReactElement {
  const { t } = useTranslation();
  const sortProps = { onSort, sortDirection, sortField };

  return (
    <div className="mt-4 overflow-x-auto rounded-2xl bg-surface shadow-card">
      <table className="w-full min-w-[1100px] table-fixed text-left text-sm">
        <colgroup>
          <col className="w-[32%]" />
          <col className="w-[22%]" />
          <col className="w-[22%]" />
          <col className="w-[16%]" />
          <col className="w-[8%]" />
        </colgroup>
        <thead className="bg-muted/40 font-semibold text-muted-foreground select-none">
          <tr>
            <TeamSortHeader
              {...sortProps}
              className="py-3 pr-2 pl-4"
              field="name"
              label={t("projectDetail.team.name")}
            />
            <TeamSortHeader
              {...sortProps}
              field="username"
              label={t("projectDetail.team.username")}
            />
            <TeamSortHeader
              {...sortProps}
              field="role"
              label={t("projectDetail.team.role")}
            />
            <TeamSortHeader
              {...sortProps}
              field="joinedAt"
              label={t("projectDetail.team.joinedAt")}
            />
            <th className="px-3 py-3 text-center">
              {t("projectDetail.team.actions")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-muted/60">
          {members.map((member) => (
            <TeamMemberRow
              key={member.userId}
              member={member}
              canWrite={canWrite}
              isLastManager={
                member.projectRole === PROJECT_ROLE.MANAGER && managerCount <= 1
              }
              onRemove={onRemove}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
