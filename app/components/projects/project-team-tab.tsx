import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Crown,
  EllipsisVertical,
  Eye,
  Pencil,
  Search,
  Send,
  Trash2,
  User as UserIcon,
  UserPlus,
  Users,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { isProjectRole, PROJECT_ROLE } from "@/definition/Project";

import type { ChangeEvent } from "react";
import type { ProjectMember, ProjectRole } from "@/definition/Project";
import type { User } from "@/definition/User";

interface ProjectTeamTabProps {
  readonly members: readonly ProjectMember[];
  readonly eligibleUsers: readonly User[];
  readonly canWrite: boolean;
}

const ROLE_ORDER: readonly ProjectRole[] = [
  PROJECT_ROLE.MANAGER,
  PROJECT_ROLE.MEMBER,
  PROJECT_ROLE.VIEWER,
];

type TeamSortField = "name" | "username" | "role" | "joinedAt";

type SortDirection = "asc" | "desc";

const ROLE_WEIGHT: Record<ProjectRole, number> = {
  manager: 0,
  member: 1,
  viewer: 2,
};

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

/**
 * Formats a stored timestamp as a German calendar date.
 *
 * @param value - Timestamp such as `2026-09-05` or `2026-09-05 14:53:21`.
 * @returns The date as `05.09.2026`, or the raw value when unparseable.
 *
 * @remarks
 * Pure string formatting keeps server and client output identical, so no
 * hydration mismatch can occur regardless of runtime locale data.
 */
function formatJoinedAt(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());

  if (!match) {
    return value;
  }

  return `${match[3]}.${match[2]}.${match[1]}`;
}

/** Renders the role icon shared by the table, dropdowns, and legend. */
function RoleIcon({
  role,
}: {
  readonly role: ProjectRole;
}): React.ReactElement {
  if (role === PROJECT_ROLE.MANAGER) {
    return <Crown className="size-4 text-primary" aria-hidden="true" />;
  }

  if (role === PROJECT_ROLE.MEMBER) {
    return (
      <Users className="size-4 text-muted-foreground" aria-hidden="true" />
    );
  }

  return <Eye className="size-4 text-muted-foreground" aria-hidden="true" />;
}

interface TeamSortHeaderProps {
  readonly field: TeamSortField;
  readonly label: string;
  readonly sortField: TeamSortField;
  readonly sortDirection: SortDirection;
  readonly onSort: (field: TeamSortField) => void;
  readonly className?: string;
}

/** Renders a sortable table header with a subtle direction indicator. */
function TeamSortHeader({
  field,
  label,
  sortField,
  sortDirection,
  onSort,
  className = "px-3 py-3",
}: TeamSortHeaderProps): React.ReactElement {
  const isActive = sortField === field;
  const SortIcon = !isActive
    ? ArrowUpDown
    : sortDirection === "asc"
      ? ArrowUp
      : ArrowDown;

  function handleClick(): void {
    onSort(field);
  }

  return (
    <th
      className={className}
      aria-sort={
        !isActive
          ? "none"
          : sortDirection === "asc"
            ? "ascending"
            : "descending"
      }
    >
      <button
        className="inline-flex cursor-pointer items-center gap-1.5 transition-colors hover:text-foreground"
        type="button"
        onClick={handleClick}
      >
        {label}
        <SortIcon
          className={
            isActive
              ? "size-3 shrink-0 text-foreground"
              : "size-3 shrink-0 opacity-60"
          }
          aria-hidden="true"
        />
      </button>
    </th>
  );
}

interface TeamMemberRowProps {
  readonly member: ProjectMember;
  readonly canWrite: boolean;
  readonly isLastManager: boolean;
  readonly onRemove: (member: ProjectMember) => void;
}

/** Renders one team member with inline role management and actions. */
function TeamMemberRow({
  member,
  canWrite,
  isLastManager,
  onRemove,
}: TeamMemberRowProps): React.ReactElement {
  const { t } = useTranslation();
  const [role, setRole] = useState<ProjectRole>(member.projectRole);

  function submitRoleForm(nextRole: ProjectRole): void {
    setRole(nextRole);

    const form = document.getElementById(`role-form-${member.userId}`);

    if (form instanceof HTMLFormElement) {
      const roleInput = form.querySelector('input[name="role"]');

      if (roleInput instanceof HTMLInputElement) {
        roleInput.value = nextRole;
      }

      form.requestSubmit();
    }
  }

  function handleRoleChange(nextValue: string): void {
    if (isProjectRole(nextValue)) {
      submitRoleForm(nextValue);
    }
  }

  function handleFocusRoleSelect(): void {
    requestAnimationFrame(() => {
      document.getElementById(`role-${member.userId}`)?.focus();
    });
  }

  function handleSetAsManager(): void {
    if (role !== PROJECT_ROLE.MANAGER) {
      submitRoleForm(PROJECT_ROLE.MANAGER);
    }
  }

  function handleRemove(): void {
    onRemove(member);
  }

  return (
    <tr className="transition-colors hover:bg-muted/40">
      <td className="py-3 pr-2 pl-4 align-middle">
        <span className="flex items-center gap-3">
          <span
            className="inline-flex size-9 shrink-0 select-none items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground"
            aria-hidden="true"
          >
            {member.displayName.trim().charAt(0).toLocaleUpperCase()}
          </span>
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
          <Form id={`role-form-${member.userId}`} method="post">
            <input name="intent" type="hidden" value="update-member-role" />
            <input name="userId" type="hidden" value={member.userId} />
            <input name="role" type="hidden" value={role} />
            <Select
              id={`role-${member.userId}`}
              ariaLabel={t("projectDetail.team.role")}
              value={role}
              onValueChange={handleRoleChange}
              className="w-[190px] max-w-full"
              options={ROLE_ORDER.map((option) => ({
                description: t(`projectDetail.team.roleDescriptions.${option}`),
                icon: <RoleIcon role={option} />,
                label: t(`projectDetail.team.${option}`),
                value: option,
              }))}
            />
          </Form>
        ) : (
          <span className="inline-flex items-center gap-2 text-sm text-foreground">
            <RoleIcon role={member.projectRole} />
            {t(`projectDetail.team.${member.projectRole}`)}
          </span>
        )}
      </td>
      <td className="px-3 py-3 align-middle text-sm whitespace-nowrap text-muted-foreground">
        <span
          className="block truncate"
          title={formatJoinedAt(member.joinedAt)}
        >
          {formatJoinedAt(member.joinedAt)}
        </span>
      </td>
      <td className="px-3 py-3 text-center align-middle">
        {canWrite ? (
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
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={handleRemove}
                  >
                    <Trash2
                      className="mr-2 size-4 shrink-0"
                      aria-hidden="true"
                    />
                    {t("projectDetail.team.withdrawInvitation")}
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuItem disabled>
                    <UserIcon
                      className="mr-2 size-4 shrink-0"
                      aria-hidden="true"
                    />
                    {t("projectDetail.team.viewProfile")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleFocusRoleSelect}>
                    <Pencil
                      className="mr-2 size-4 shrink-0"
                      aria-hidden="true"
                    />
                    {t("projectDetail.team.changeRole")}
                  </DropdownMenuItem>
                  {role !== PROJECT_ROLE.MANAGER ? (
                    <DropdownMenuItem onSelect={handleSetAsManager}>
                      <Crown
                        className="mr-2 size-4 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                      {t("projectDetail.team.setAsManager")}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive"
                    disabled={isLastManager}
                    title={
                      isLastManager
                        ? t("projectDetail.team.lastManagerHint")
                        : undefined
                    }
                    onSelect={handleRemove}
                  >
                    <Trash2
                      className="mr-2 size-4 shrink-0"
                      aria-hidden="true"
                    />
                    {t("projectDetail.team.removeMember")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </td>
    </tr>
  );
}

/** Renders the dialog for adding an eligible user with an initial role. */
function AddMemberDialog({
  eligibleUsers,
}: {
  readonly eligibleUsers: readonly User[];
}): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedRole, setSelectedRole] = useState<ProjectRole>(
    PROJECT_ROLE.MEMBER,
  );

  function handleRoleChange(nextValue: string): void {
    if (isProjectRole(nextValue)) {
      setSelectedRole(nextValue);
    }
  }

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
          <Select
            id="add-member-role"
            ariaLabel={t("projectDetail.team.role")}
            value={selectedRole}
            onValueChange={handleRoleChange}
            className="w-full"
            options={ROLE_ORDER.map((option) => ({
              description: t(`projectDetail.team.roleDescriptions.${option}`),
              icon: <RoleIcon role={option} />,
              label: t(`projectDetail.team.${option}`),
              value: option,
            }))}
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
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [memberToRemove, setMemberToRemove] = useState<ProjectMember | null>(
    null,
  );

  const managerCount = members.filter(
    (member) => member.projectRole === PROJECT_ROLE.MANAGER,
  ).length;

  const query = search.trim().toLocaleLowerCase();
  const filteredMembers = members.filter(
    (member) =>
      !query ||
      member.displayName.toLocaleLowerCase().includes(query) ||
      member.username.toLocaleLowerCase().includes(query),
  );
  const sortedMembers = [...filteredMembers].sort((first, second) => {
    const comparison =
      sortField === "name"
        ? first.displayName.localeCompare(second.displayName)
        : sortField === "username"
          ? first.username.localeCompare(second.username)
          : sortField === "role"
            ? ROLE_WEIGHT[first.projectRole] - ROLE_WEIGHT[second.projectRole]
            : first.joinedAt.localeCompare(second.joinedAt);

    return sortDirection === "asc" ? comparison : -comparison;
  });

  const pageCount = Math.max(1, Math.ceil(sortedMembers.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleMembers = sortedMembers.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );
  const rangeStart =
    sortedMembers.length === 0 ? 0 : currentPage * pageSize + 1;
  const rangeEnd = Math.min(sortedMembers.length, (currentPage + 1) * pageSize);

  function handleSearchChange(event: ChangeEvent<HTMLInputElement>): void {
    setSearch(event.target.value);
    setPage(0);
  }

  function handleSortClick(field: TeamSortField): void {
    if (field === sortField) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }

    setPage(0);
  }

  function handlePageSizeChange(nextValue: string): void {
    const nextPageSize = Number.parseInt(nextValue, 10);

    if ((PAGE_SIZE_OPTIONS as readonly number[]).includes(nextPageSize)) {
      setPageSize(nextPageSize);
      setPage(0);
    }
  }

  function handlePreviousPage(): void {
    setPage((current) => Math.max(0, current - 1));
  }

  function handleNextPage(): void {
    setPage((current) => Math.min(pageCount - 1, current + 1));
  }

  function handleRemoveRequest(member: ProjectMember): void {
    setMemberToRemove(member);
  }

  function handleRemoveDialogChange(open: boolean): void {
    if (!open) {
      setMemberToRemove(null);
    }
  }

  function handleRemoveSubmit(): void {
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
        <div className="relative mt-6 h-9 w-full sm:max-w-80">
          <Search
            className="pointer-events-none absolute top-1/2 left-4 size-4 shrink-0 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="h-9 rounded-lg bg-card pr-3 pl-11 text-xs xl:pr-3 xl:pl-11"
            value={search}
            onChange={handleSearchChange}
            placeholder={t("projectDetail.team.searchMembers")}
            aria-label={t("projectDetail.team.searchMembers")}
          />
        </div>
      ) : null}

      {sortedMembers.length ? (
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
                  field="name"
                  label={t("projectDetail.team.name")}
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSort={handleSortClick}
                  className="py-3 pr-2 pl-4"
                />
                <TeamSortHeader
                  field="username"
                  label={t("projectDetail.team.username")}
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSort={handleSortClick}
                />
                <TeamSortHeader
                  field="role"
                  label={t("projectDetail.team.role")}
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSort={handleSortClick}
                />
                <TeamSortHeader
                  field="joinedAt"
                  label={t("projectDetail.team.joinedAt")}
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSort={handleSortClick}
                />
                <th className="px-3 py-3 text-center">
                  {t("projectDetail.team.actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-muted/60">
              {visibleMembers.map((member) => (
                <TeamMemberRow
                  key={member.userId}
                  member={member}
                  canWrite={canWrite}
                  isLastManager={
                    member.projectRole === PROJECT_ROLE.MANAGER &&
                    managerCount <= 1
                  }
                  onRemove={handleRemoveRequest}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 rounded-2xl bg-muted/40 p-10 text-center text-sm text-muted-foreground">
          {members.length === 0
            ? t("projectDetail.team.empty")
            : t("projectDetail.team.noMatches")}
        </div>
      )}

      {members.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">
              {members.length}
            </span>{" "}
            {members.length === 1
              ? t("projectDetail.team.member")
              : t("projectDetail.team.members")}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {t("projectDetail.team.pageSize")}
            </span>
            <Select
              ariaLabel={t("projectDetail.team.pageSize")}
              value={String(pageSize)}
              onValueChange={handlePageSizeChange}
              className="min-w-20"
              options={PAGE_SIZE_OPTIONS.map((option) => ({
                value: String(option),
                label: String(option),
              }))}
            />
            <span className="text-sm text-muted-foreground">
              {t("projectDetail.team.rangeOfTotal", {
                from: rangeStart,
                to: rangeEnd,
                total: sortedMembers.length,
              })}
            </span>
            <span className="flex gap-1">
              <Button
                className="size-9 min-h-0 px-0"
                variant="ghost"
                aria-label={t("projectDetail.team.previousPage")}
                disabled={currentPage === 0}
                onClick={handlePreviousPage}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Button>
              <Button
                className="size-9 min-h-0 px-0"
                variant="ghost"
                aria-label={t("projectDetail.team.nextPage")}
                disabled={currentPage >= pageCount - 1}
                onClick={handleNextPage}
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </span>
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:gap-8">
        {ROLE_ORDER.map((role) => (
          <div key={role} className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
              <RoleIcon role={role} />
            </span>
            <span>
              <span className="block text-sm font-semibold text-foreground">
                {t(`projectDetail.team.${role}`)}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                {t(`projectDetail.team.roleDescriptions.${role}`)}
              </span>
            </span>
          </div>
        ))}
      </div>

      <Dialog
        open={memberToRemove !== null}
        onOpenChange={handleRemoveDialogChange}
      >
        <DialogContent className="w-[min(26rem,90vw)]">
          <DialogTitle className="select-none text-lg font-semibold text-foreground">
            {t("projectDetail.team.removeTitle")}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {t("projectDetail.team.removeDescription", {
              name: memberToRemove?.displayName ?? "",
            })}
          </DialogDescription>
          <Form
            className="mt-5 flex justify-end gap-2"
            method="post"
            onSubmit={handleRemoveSubmit}
          >
            <input name="intent" type="hidden" value="remove-member" />
            <input
              name="userId"
              type="hidden"
              value={memberToRemove?.userId ?? ""}
            />
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
    </div>
  );
}
