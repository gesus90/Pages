import { expect, it, vi } from "vitest";

import { CalendarSourceRepository } from "./CalendarSourceRepository";

import type { CalendarDatabase } from "./CalendarEventRepository";

function doubleOf(rows: unknown[][] = []): {
  repository: CalendarSourceRepository;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  return {
    repository: new CalendarSourceRepository({
      query,
      execute: vi.fn(),
    } as unknown as CalendarDatabase),
    query,
  };
}

const RANGE = { fromDate: "2026-01-01", toDate: "2026-01-31" };

it("maps project dates and shortens the time to minutes", async () => {
  const { repository, query } = doubleOf([
    ["d1", "p1", "Alpha", "Kickoff", "", "2026-01-05", "09:30:00"],
    ["d2", "p1", "Alpha", "Review", "Text", "2026-01-06", null],
  ]);

  await expect(repository.findProjectDates(["p1"], RANGE)).resolves.toEqual([
    {
      id: "d1",
      projectId: "p1",
      projectName: "Alpha",
      title: "Kickoff",
      description: "",
      date: "2026-01-05",
      time: "09:30",
    },
    {
      id: "d2",
      projectId: "p1",
      projectName: "Alpha",
      title: "Review",
      description: "Text",
      date: "2026-01-06",
      time: null,
    },
  ]);
  expect(query.mock.calls[0]?.[1]).toMatchObject({
    from_date: "2026-01-01",
    to_date: "2026-01-31",
  });
});

it("maps due tickets of an account and its groups", async () => {
  const { repository, query } = doubleOf([
    ["t1", "ABC-1", "Fix", "p1", "Alpha", "2026-01-09"],
  ]);

  await expect(
    repository.findDueTickets(
      { userId: "u1", groupIds: ["g1"] },
      { departmentIds: null },
      RANGE,
    ),
  ).resolves.toEqual([
    {
      id: "t1",
      key: "ABC-1",
      title: "Fix",
      projectId: "p1",
      projectName: "Alpha",
      date: "2026-01-09",
    },
  ]);
  const parameters = query.mock.calls[0]?.[1] as Record<string, unknown>;
  expect(parameters.user_id).toBe("u1");
  expect(Object.values(parameters)).toContain("g1");
});

it("maps milestones", async () => {
  const { repository } = doubleOf([
    ["m1", "Beta", "", "p1", "Alpha", "2026-01-20"],
  ]);

  await expect(repository.findMilestones(["p1"], RANGE)).resolves.toEqual([
    {
      id: "m1",
      name: "Beta",
      description: "",
      projectId: "p1",
      projectName: "Alpha",
      date: "2026-01-20",
    },
  ]);
});

it("maps project names", async () => {
  const { repository } = doubleOf([["p1", "Alpha"]]);

  await expect(repository.findProjectNames(["p1"])).resolves.toEqual([
    { id: "p1", name: "Alpha" },
  ]);
});
