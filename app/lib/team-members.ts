import { PROJECT_ROLE } from "@/definition/Project";

import type { ProjectMember, ProjectRole } from "@/definition/Project";

/** Columns the team table can be sorted by. */
export type TeamSortField = "name" | "username" | "role" | "joinedAt";

/** Direction of a table sort. */
export type SortDirection = "asc" | "desc";

/** Page sizes of the team table, as the values of its select. */
export const PAGE_SIZE_KEYS = ["10", "25", "50"] as const;

/** One of the selectable page sizes. */
export type PageSizeKey = (typeof PAGE_SIZE_KEYS)[number];

/** Project roles in the order they are listed and explained. */
export const TEAM_ROLE_ORDER: readonly ProjectRole[] = [
  PROJECT_ROLE.MANAGER,
  PROJECT_ROLE.MEMBER,
  PROJECT_ROLE.VIEWER,
];

const ROLE_WEIGHT: Record<ProjectRole, number> = {
  manager: 0,
  member: 1,
  viewer: 2,
};

const COMPARATORS: Record<
  TeamSortField,
  (first: ProjectMember, second: ProjectMember) => number
> = {
  joinedAt: (first, second) => first.joinedAt.localeCompare(second.joinedAt),
  name: (first, second) => first.displayName.localeCompare(second.displayName),
  role: (first, second) =>
    ROLE_WEIGHT[first.projectRole] - ROLE_WEIGHT[second.projectRole],
  username: (first, second) => first.username.localeCompare(second.username),
};

/** A window onto the sorted team members. */
export interface TeamPage {
  readonly members: readonly ProjectMember[];
  readonly currentPage: number;
  readonly pageCount: number;
  readonly rangeStart: number;
  readonly rangeEnd: number;
}

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
export function formatJoinedAt(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());

  if (!match) {
    return value;
  }

  return `${match[3]}.${match[2]}.${match[1]}`;
}

/**
 * Keeps the members whose name or username contains the query.
 *
 * @param members - Every member of the project.
 * @param search - Text typed into the search field; blank keeps everyone.
 */
export function filterMembers(
  members: readonly ProjectMember[],
  search: string,
): readonly ProjectMember[] {
  const query = search.trim().toLocaleLowerCase();

  return members.filter(
    (member) =>
      !query ||
      member.displayName.toLocaleLowerCase().includes(query) ||
      member.username.toLocaleLowerCase().includes(query),
  );
}

/** Returns the members ordered by a column; the input stays untouched. */
export function sortMembers(
  members: readonly ProjectMember[],
  field: TeamSortField,
  direction: SortDirection,
): readonly ProjectMember[] {
  const factor = direction === "asc" ? 1 : -1;

  return [...members].sort(
    (first, second) => factor * COMPARATORS[field](first, second),
  );
}

/**
 * Cuts one page out of the sorted members.
 *
 * @param members - The members in display order.
 * @param page - The requested zero-based page, clamped to the last one.
 * @param pageSize - Members per page.
 */
export function paginateMembers(
  members: readonly ProjectMember[],
  page: number,
  pageSize: number,
): TeamPage {
  const pageCount = Math.max(1, Math.ceil(members.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);

  return {
    currentPage,
    members: members.slice(
      currentPage * pageSize,
      (currentPage + 1) * pageSize,
    ),
    pageCount,
    rangeEnd: Math.min(members.length, (currentPage + 1) * pageSize),
    rangeStart: members.length === 0 ? 0 : currentPage * pageSize + 1,
  };
}
