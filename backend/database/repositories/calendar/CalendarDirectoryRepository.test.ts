import { expect, it, vi } from "vitest";

import { CalendarDirectoryRepository } from "./CalendarDirectoryRepository";

function repositoryOf(...results: unknown[][][]): {
  repository: CalendarDirectoryRepository;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn();
  for (const rows of results) query.mockResolvedValueOnce(rows);
  query.mockResolvedValue([]);
  return {
    repository: new CalendarDirectoryRepository({
      query,
      execute: vi.fn(),
    }),
    query,
  };
}

it("reads the memberships of an account", async () => {
  const { repository, query } = repositoryOf([["g1"], ["g2"]], [["d1"]]);

  await expect(repository.findMemberships("u1")).resolves.toEqual({
    groupIds: ["g1", "g2"],
    departmentIds: ["d1"],
  });
  expect(query.mock.calls[0]?.[1]).toEqual({ user_id: "u1" });
});

it("maps accounts and recognises agents", async () => {
  const { repository } = repositoryOf([
    ["a1", "Ada", "agent", 1],
    ["p1", "Pia", "human", 0],
  ]);

  await expect(repository.findAccounts(["a1", "p1"])).resolves.toEqual([
    { id: "a1", name: "Ada", isAgent: true, isActive: true },
    { id: "p1", name: "Pia", isAgent: false, isActive: false },
  ]);
});

it("maps groups and departments with an empty list matching nothing", async () => {
  const { repository, query } = repositoryOf([["g1", "Core"]], [["d1", "Ops"]]);

  await expect(repository.findGroups([])).resolves.toEqual([
    { id: "g1", name: "Core" },
  ]);
  await expect(repository.findDepartments(["d1"])).resolves.toEqual([
    { id: "d1", name: "Ops" },
  ]);
  expect(query.mock.calls[0]?.[1]).toEqual({});
});

it("maps the members of groups and departments", async () => {
  const { repository } = repositoryOf([["g1", "u1"]], [["d1", "u2"]]);

  await expect(repository.findGroupMembers(["g1"])).resolves.toEqual([
    { containerId: "g1", userId: "u1" },
  ]);
  await expect(repository.findDepartmentMembers(["d1"])).resolves.toEqual([
    { containerId: "d1", userId: "u2" },
  ]);
});

it("searches invitees with an escaped pattern and skips unknown kinds", async () => {
  const { repository, query } = repositoryOf([
    ["person", "p1", "Pia"],
    ["agent", "a1", "Ada"],
    ["group", "g1", "Core"],
    ["department", "d1", "Ops"],
    ["other", "x", "Odd"],
  ]);

  await expect(repository.searchInvitees(" 50%_A\\ ", 5)).resolves.toEqual([
    { kind: "person", id: "p1", name: "Pia" },
    { kind: "agent", id: "a1", name: "Ada" },
    { kind: "group", id: "g1", name: "Core" },
    { kind: "department", id: "d1", name: "Ops" },
  ]);
  expect(query.mock.calls[0]?.[1]).toEqual({
    pattern: "%50\\%\\_a\\\\%",
    limit: 5,
  });
});
