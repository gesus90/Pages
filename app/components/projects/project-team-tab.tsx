import { useState } from "react";
import { useTranslation } from "react-i18next";

import { AddMemberDialog } from "@/app/components/projects/add-member-dialog";
import { RemoveMemberDialog } from "@/app/components/projects/remove-member-dialog";
import { TeamMemberTable } from "@/app/components/projects/team-member-table";
import { TeamPagination } from "@/app/components/projects/team-pagination";
import { TeamRoleLegend } from "@/app/components/projects/team-role-legend";
import { TeamSearchField } from "@/app/components/projects/team-search-field";
import {
  PAGE_SIZE_KEYS,
  filterMembers,
  paginateMembers,
  sortMembers,
} from "@/app/lib/team-members";
import { PROJECT_ROLE } from "@/definition/Project";

import type { ChangeEvent } from "react";
import type {
  PageSizeKey,
  SortDirection,
  TeamSortField,
} from "@/app/lib/team-members";
import type { ProjectMember } from "@/definition/Project";
import type { User } from "@/definition/User";

interface ProjectTeamTabProps {
  readonly members: readonly ProjectMember[];
  readonly eligibleUsers: readonly User[];
  readonly canWrite: boolean;
}

/** Renders team management as a central, sortable table. */
export function ProjectTeamTab({
  members,
  eligibleUsers,
  canWrite,
}: ProjectTeamTabProps): React.ReactElement {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<TeamSortField>("role");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState<PageSizeKey>(PAGE_SIZE_KEYS[0]);
  const [memberToRemove, setMemberToRemove] = useState<ProjectMember | null>(
    null,
  );

  const managerCount = members.filter(
    (member) => member.projectRole === PROJECT_ROLE.MANAGER,
  ).length;
  const sortedMembers = sortMembers(
    filterMembers(members, search),
    sortField,
    sortDirection,
  );
  const page = paginateMembers(sortedMembers, pageIndex, Number(pageSize));

  function handleSearchChange(event: ChangeEvent<HTMLInputElement>): void {
    setSearch(event.target.value);
    setPageIndex(0);
  }

  function handleSortClick(field: TeamSortField): void {
    if (field === sortField) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }

    setPageIndex(0);
  }

  function handlePageSizeChange(nextPageSize: PageSizeKey): void {
    setPageSize(nextPageSize);
    setPageIndex(0);
  }

  function handlePreviousPage(): void {
    setPageIndex(Math.max(0, page.currentPage - 1));
  }

  function handleNextPage(): void {
    setPageIndex(Math.min(page.pageCount - 1, page.currentPage + 1));
  }

  function handleRemoveClose(): void {
    setMemberToRemove(null);
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="select-none text-xl font-semibold tracking-tight text-foreground">
            {t("projectDetail.team.manageTitle")}
          </h2>
          <p className="mt-1 select-none text-sm text-muted-foreground">
            {t("projectDetail.team.manageSubtitle")}
          </p>
        </div>
        {canWrite ? <AddMemberDialog eligibleUsers={eligibleUsers} /> : null}
      </div>

      {canWrite || members.length > 0 ? (
        <TeamSearchField onChange={handleSearchChange} value={search} />
      ) : null}

      {sortedMembers.length ? (
        <TeamMemberTable
          canWrite={canWrite}
          managerCount={managerCount}
          members={page.members}
          onRemove={setMemberToRemove}
          onSort={handleSortClick}
          sortDirection={sortDirection}
          sortField={sortField}
        />
      ) : (
        <div className="mt-4 rounded-2xl bg-muted/40 p-10 text-center text-sm text-muted-foreground">
          {members.length === 0
            ? t("projectDetail.team.empty")
            : t("projectDetail.team.noMatches")}
        </div>
      )}

      {members.length > 0 ? (
        <TeamPagination
          matchCount={sortedMembers.length}
          memberCount={members.length}
          onNext={handleNextPage}
          onPageSizeChange={handlePageSizeChange}
          onPrevious={handlePreviousPage}
          page={page}
          pageSize={pageSize}
        />
      ) : null}

      <TeamRoleLegend />

      <RemoveMemberDialog member={memberToRemove} onClose={handleRemoveClose} />
    </div>
  );
}
