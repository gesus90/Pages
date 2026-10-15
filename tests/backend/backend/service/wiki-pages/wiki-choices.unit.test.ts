import { beforeEach, describe, expect, it } from "vitest";

import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";

import { createPeopleWorld } from "./wiki-people";

let world = createPeopleWorld();

beforeEach(() => {
  world = createPeopleWorld();
  world.addTarget("department", "sales");
  world.addTarget("milestone", "m1", { projectId: "alpha" });
  world.reading.departments = [
    { id: "sales", name: "Sales" },
    { id: "legal", name: "Legal" },
  ];
  world.reading.milestones = [
    { id: "m1", name: "Launch", projectId: "alpha", projectName: "Alpha" },
    { id: "m2", name: "Other", projectId: "beta", projectName: "Beta" },
  ];
  world.reading.epics = [
    {
      departmentId: null,
      id: "e1",
      key: "A-1",
      projectId: "alpha",
      title: "Open",
    },
    {
      departmentId: "sales",
      id: "e2",
      key: "A-2",
      projectId: "alpha",
      title: "Mine",
    },
    {
      departmentId: "legal",
      id: "e3",
      key: "A-3",
      projectId: "alpha",
      title: "Legal",
    },
  ];
  world.addPage({ id: "wide", ownerId: "owner" });
  world.addPage({
    id: "team",
    ownerId: "owner",
    projectId: "alpha",
    scope: "project",
  });
  world.addPage({ id: "mine", ownerId: "owner", scope: "private" });
  world.addAnchor("wide", "department", "sales");
});

describe("anchor choices", () => {
  it("offers a manager what they can read, limited to their departments", async () => {
    const choices = await world
      .facade()
      .anchorChoices(world.actor("owner"), "wide");
    expect(choices.departments).toEqual([{ id: "sales", name: "Sales" }]);
    expect(choices.milestones.map((item) => item.id)).toEqual(["m1"]);
    expect(choices.epics.map((item) => item.id)).toEqual(["e1", "e2"]);
    expect(choices.selected).toEqual([
      { kind: "department", targetId: "sales" },
    ]);
  });

  it("offers an administrator every department and epic", async () => {
    const choices = await world
      .facade()
      .anchorChoices(world.actor("admin"), "wide");
    expect(choices.departments.map((item) => item.id)).toEqual([
      "sales",
      "legal",
    ]);
    expect(choices.epics.map((item) => item.id)).toEqual(["e1", "e2", "e3"]);
  });

  it("limits the targets of a project page to its project", async () => {
    await world.facade().anchorChoices(world.actor("admin"), "team");
    expect(world.reading.choiceProjects).toEqual([["alpha"]]);
    await world.facade().anchorChoices(world.actor("admin"), "wide");
    expect(world.reading.choiceProjects[1]).toEqual(["alpha", "beta"]);
  });

  it("gives everybody else only the selection, and private pages none", async () => {
    await expect(
      world.facade().anchorChoices(world.actor("other"), "wide"),
    ).resolves.toEqual({
      departments: [],
      epics: [],
      milestones: [],
      selected: [{ kind: "department", targetId: "sales" }],
    });
    await expect(
      world.facade().anchorChoices(world.actor("owner"), "mine"),
    ).resolves.toMatchObject({ departments: [], epics: [], milestones: [] });
    expect(world.reading.choiceProjects).toEqual([]);
  });

  it("answers a hidden page with not found", async () => {
    await expect(
      world.facade().anchorChoices(world.actor("other"), "mine"),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
  });
});

describe("owner candidates", () => {
  it("lists the active accounts for writers and nothing for others", async () => {
    world.reading.activeUsers = [{ displayName: "Bob", id: "bob" }];
    await expect(
      world.facade().ownerCandidates(world.actor("owner")),
    ).resolves.toEqual([{ displayName: "Bob", id: "bob" }]);
    await expect(
      world.facade().ownerCandidates(world.actor("reader")),
    ).resolves.toEqual([]);
  });
});
