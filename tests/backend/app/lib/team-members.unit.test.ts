import { describe, expect, it } from "vitest";

import {
  PAGE_SIZE_KEYS,
  TEAM_ROLE_ORDER,
  filterMembers,
  formatJoinedAt,
  paginateMembers,
  sortMembers,
} from "@/app/lib/team-members";

import type { ProjectMember, ProjectRole } from "@/definition/Project";

function member(
  username: string,
  displayName: string,
  projectRole: ProjectRole = "member",
  joinedAt = "2026-01-01 10:00:00",
): ProjectMember {
  return {
    userId: `id-${username}`,
    username,
    displayName,
    projectRole,
    joinedAt,
  };
}

const MEMBERS = [
  member("carol", "Carol Danvers", "viewer", "2026-03-01"),
  member("alice", "Alice Zhang", "manager", "2026-01-01"),
  member("bob", "Bob Müller", "member", "2026-02-01"),
];

function usernames(members: readonly ProjectMember[]): string[] {
  return members.map((entry) => entry.username);
}

describe("team members", () => {
  it("orders the roles from manager to viewer and offers three page sizes", () => {
    expect(TEAM_ROLE_ORDER).toEqual(["manager", "member", "viewer"]);
    expect(PAGE_SIZE_KEYS).toEqual(["10", "25", "50"]);
  });

  it("writes the join date day first and returns an unreadable value unchanged", () => {
    expect(formatJoinedAt("2026-03-09 12:30:00")).toBe("09.03.2026");
    expect(formatJoinedAt("  2026-03-09")).toBe("09.03.2026");
    expect(formatJoinedAt("yesterday")).toBe("yesterday");
    expect(formatJoinedAt("")).toBe("");
  });

  it("filters by a part of the display name or the username, ignoring case and blanks", () => {
    expect(usernames(filterMembers(MEMBERS, " MÜLL "))).toEqual(["bob"]);
    expect(usernames(filterMembers(MEMBERS, "al"))).toEqual(["alice"]);
    expect(usernames(filterMembers(MEMBERS, "ca"))).toEqual(["carol"]);
    expect(usernames(filterMembers(MEMBERS, "   "))).toEqual([
      "carol",
      "alice",
      "bob",
    ]);
    expect(filterMembers(MEMBERS, "nobody")).toEqual([]);
  });

  it.each([
    { field: "name", direction: "asc", expected: ["alice", "bob", "carol"] },
    { field: "name", direction: "desc", expected: ["carol", "bob", "alice"] },
    {
      field: "username",
      direction: "asc",
      expected: ["alice", "bob", "carol"],
    },
    { field: "role", direction: "asc", expected: ["alice", "bob", "carol"] },
    { field: "role", direction: "desc", expected: ["carol", "bob", "alice"] },
    {
      field: "joinedAt",
      direction: "asc",
      expected: ["alice", "bob", "carol"],
    },
    {
      field: "joinedAt",
      direction: "desc",
      expected: ["carol", "bob", "alice"],
    },
  ] as const)(
    "sorts by $field $direction",
    ({ field, direction, expected }) => {
      expect(usernames(sortMembers(MEMBERS, field, direction))).toEqual(
        expected,
      );
    },
  );

  it("sorts a copy and leaves the given list alone", () => {
    const before = usernames(MEMBERS);

    sortMembers(MEMBERS, "name", "asc");

    expect(usernames(MEMBERS)).toEqual(before);
  });
});

describe("paginating members", () => {
  const many = Array.from({ length: 23 }, (_, index) =>
    member(`user${index}`, `User ${index}`),
  );

  it("slices a page and reports the shown range", () => {
    const page = paginateMembers(many, 1, 10);

    expect(usernames(page.members)).toEqual(
      many.slice(10, 20).map((entry) => entry.username),
    );
    expect(page).toMatchObject({
      currentPage: 1,
      pageCount: 3,
      rangeStart: 11,
      rangeEnd: 20,
    });
  });

  it("ends the last page at the last member", () => {
    expect(paginateMembers(many, 2, 10)).toMatchObject({
      currentPage: 2,
      rangeStart: 21,
      rangeEnd: 23,
    });
  });

  it("keeps a page beyond the end on the last page", () => {
    expect(paginateMembers(many, 99, 10).currentPage).toBe(2);
  });

  it("shows one empty page without members", () => {
    expect(paginateMembers([], 0, 10)).toEqual({
      members: [],
      currentPage: 0,
      pageCount: 1,
      rangeStart: 0,
      rangeEnd: 0,
    });
  });
});
