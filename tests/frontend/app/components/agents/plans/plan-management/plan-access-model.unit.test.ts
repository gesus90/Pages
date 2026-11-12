import { expect, it } from "vitest";

import {
  planTeamChoices,
  planTeamName,
  withPlanTeam,
  withPlanTeamRight,
} from "@/app/components/agents/plans/plan-management/plan-access-model";

const DIRECTORY = {
  persons: [],
  groups: [{ id: "a-team", name: "A-Team" }],
  departments: [{ id: "development", name: "Entwicklung" }],
};

it("finds groups and departments by name and leaves out the chosen ones", () => {
  const teams = withPlanTeam([], {
    kind: "group",
    id: "a-team",
    name: "A-Team",
  });
  expect(teams).toEqual([
    {
      kind: "group",
      targetId: "a-team",
      canRead: true,
      canEdit: true,
      canRun: true,
    },
  ]);
  expect(planTeamChoices(DIRECTORY, teams, "")).toEqual([
    { kind: "department", id: "development", name: "Entwicklung" },
  ]);
  expect(planTeamChoices(DIRECTORY, [], "TEAM")).toEqual([
    { kind: "group", id: "a-team", name: "A-Team" },
  ]);
});

it("keeps reading on while changing or running, and switches both off without reading", () => {
  const [team] = withPlanTeam([], {
    kind: "department",
    id: "development",
    name: "Entwicklung",
  });
  if (!team) throw new Error("missing team");
  const readOnly = withPlanTeamRight([team], 0, {
    right: "canRead",
    isOn: false,
  });
  expect(readOnly[0]).toMatchObject({
    canRead: false,
    canEdit: false,
    canRun: false,
  });
  expect(
    withPlanTeamRight(readOnly, 0, { right: "canRun", isOn: true })[0],
  ).toMatchObject({ canRead: true, canEdit: false, canRun: true });
});

it("names a team the directory no longer knows by its identifier", () => {
  expect(planTeamName(DIRECTORY, { kind: "group", targetId: "gone" })).toBe(
    "gone",
  );
  expect(
    planTeamName(DIRECTORY, { kind: "department", targetId: "development" }),
  ).toBe("Entwicklung");
});
