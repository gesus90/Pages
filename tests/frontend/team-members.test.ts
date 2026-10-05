import { describe, expect, it } from "vitest";

import {
  filterMembers,
  formatJoinedAt,
  paginateMembers,
  sortMembers,
} from "@/app/lib/team-members";

import type { ProjectMember } from "@/definition/Project";

function createMember(overrides: Partial<ProjectMember> = {}): ProjectMember {
  return {
    displayName: "Alex Berger",
    joinedAt: "2026-09-05",
    projectRole: "member",
    userId: "user-1",
    username: "alex",
    ...overrides,
  };
}

const MEMBERS: readonly ProjectMember[] = [
  createMember({
    displayName: "Cara",
    joinedAt: "2026-01-03",
    projectRole: "viewer",
    userId: "c",
    username: "alpha",
  }),
  createMember({
    displayName: "Anna",
    joinedAt: "2026-03-01",
    projectRole: "manager",
    userId: "a",
    username: "charlie",
  }),
  createMember({
    displayName: "Ben",
    joinedAt: "2026-02-02",
    projectRole: "member",
    userId: "b",
    username: "bravo",
  }),
];

function ids(members: readonly ProjectMember[]): string[] {
  return members.map((member) => member.userId);
}

describe("formatJoinedAt", () => {
  it.each([
    ["2026-09-05", "05.09.2026"],
    ["2026-09-05 14:53:21", "05.09.2026"],
    [" 2026-09-05 ", "05.09.2026"],
    ["yesterday", "yesterday"],
    ["", ""],
  ])("formats %j as %j", (value, expected) => {
    expect(formatJoinedAt(value)).toBe(expected);
  });
});

describe("filterMembers", () => {
  it("keeps everyone for a blank search", () => {
    expect(filterMembers(MEMBERS, "   ")).toEqual(MEMBERS);
  });

  it("matches names and usernames without regard to case", () => {
    expect(ids(filterMembers(MEMBERS, "ANNA"))).toEqual(["a"]);
    expect(ids(filterMembers(MEMBERS, " bravo "))).toEqual(["b"]);
    expect(ids(filterMembers(MEMBERS, "xyz"))).toEqual([]);
  });
});

describe("sortMembers", () => {
  it.each([
    ["name", "asc", ["a", "b", "c"]],
    ["name", "desc", ["c", "b", "a"]],
    ["username", "asc", ["c", "b", "a"]],
    ["role", "asc", ["a", "b", "c"]],
    ["role", "desc", ["c", "b", "a"]],
    ["joinedAt", "asc", ["c", "b", "a"]],
    ["joinedAt", "desc", ["a", "b", "c"]],
  ] as const)("orders by %s %s", (field, direction, expected) => {
    expect(ids(sortMembers(MEMBERS, field, direction))).toEqual(expected);
  });

  it("leaves the input untouched", () => {
    const before = ids(MEMBERS);

    sortMembers(MEMBERS, "name", "asc");

    expect(ids(MEMBERS)).toEqual(before);
  });
});

describe("paginateMembers", () => {
  const many = Array.from({ length: 25 }, (_, index) =>
    createMember({ userId: `user-${index}` }),
  );

  it("cuts the first page", () => {
    const page = paginateMembers(many, 0, 10);

    expect(page.members).toHaveLength(10);
    expect(page).toMatchObject({
      currentPage: 0,
      pageCount: 3,
      rangeEnd: 10,
      rangeStart: 1,
    });
  });

  it("ends with a short last page", () => {
    const page = paginateMembers(many, 2, 10);

    expect(page.members).toHaveLength(5);
    expect(page).toMatchObject({ rangeEnd: 25, rangeStart: 21 });
  });

  it("clamps a page beyond the end", () => {
    expect(paginateMembers(many, 9, 10).currentPage).toBe(2);
  });

  it("reports an empty range without members", () => {
    expect(paginateMembers([], 3, 10)).toEqual({
      currentPage: 0,
      members: [],
      pageCount: 1,
      rangeEnd: 0,
      rangeStart: 0,
    });
  });
});
