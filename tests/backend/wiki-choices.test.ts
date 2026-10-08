import { describe, expect, it } from "vitest";

import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";

import { useMigratedDatabase } from "../helpers/test-database";
import { createWikiHarness, pageInput } from "../helpers/wiki-harness";

describe("wiki choices", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const harness = createWikiHarness(getDatabase());

    await harness.addDepartment("sales");
    await harness.addDepartment("dev");
    await harness.addProject("p1");
    await harness.addProject("p2");
    await harness.addMilestone("m1", "p1");
    await harness.addMilestone("m2", "p2");
    await harness.addEpic("e1", "p1");
    await harness.addEpic("e-dev", "p1", "dev");
    await harness.addEpic("e-sales", "p2", "sales");

    const ada = await harness.addUser("ada", { departments: ["sales"] });
    const bob = await harness.addUser("bob");
    const reader = await harness.addUser("reader", { capabilities: [] });
    const admin = await harness.addUser("admin", {
      isAdmin: true,
      mode: "admin",
    });

    return { ...harness, ada, admin, bob, reader };
  }

  it("offers the targets the person can read, for a page they manage", async () => {
    const { ada, service } = await setup();
    const page = await service.create(
      ada,
      pageInput({ anchors: [{ kind: "milestone", targetId: "m1" }] }),
    );
    const choices = await service.anchorChoices(ada, page.id);

    expect(choices.departments).toEqual([
      { id: "sales", name: "Department sales" },
    ]);
    expect(choices.milestones.map((milestone) => milestone.id)).toEqual([
      "m1",
      "m2",
    ]);
    expect(choices.epics.map((epic) => epic.id)).toEqual(["e1", "e-sales"]);
    expect(choices.selected).toEqual([{ kind: "milestone", targetId: "m1" }]);
  });

  it("offers a project page only the targets of its project", async () => {
    const { ada, service } = await setup();
    const page = await service.create(
      ada,
      pageInput({ projectId: "p2", scope: "project" }),
    );
    const choices = await service.anchorChoices(ada, page.id);

    expect(choices.milestones.map((milestone) => milestone.id)).toEqual(["m2"]);
    expect(choices.epics.map((epic) => epic.id)).toEqual(["e-sales"]);
  });

  it("offers administrators every department and epic", async () => {
    const { admin, ada, service } = await setup();
    const page = await service.create(ada, pageInput());
    const choices = await service.anchorChoices(admin, page.id);

    expect(choices.departments.map((department) => department.id)).toEqual([
      "dev",
      "sales",
    ]);
    expect(choices.epics.map((epic) => epic.id)).toEqual([
      "e-dev",
      "e1",
      "e-sales",
    ]);
  });

  it("offers nothing to people who do not manage the page or for private pages", async () => {
    const { ada, bob, service } = await setup();
    const shared = await service.create(ada, pageInput());
    const secret = await service.create(ada, pageInput({ scope: "private" }));

    expect(await service.anchorChoices(bob, shared.id)).toEqual({
      departments: [],
      epics: [],
      milestones: [],
      selected: [],
    });
    expect((await service.anchorChoices(ada, secret.id)).departments).toEqual(
      [],
    );
    await expect(service.anchorChoices(bob, secret.id)).rejects.toBeInstanceOf(
      WikiPageNotFoundError,
    );
  });

  it("lists active accounts as owners for people who can write", async () => {
    const { ada, reader, service, database } = await setup();

    await database.execute("UPDATE users SET is_active = 0 WHERE id = 'bob';");

    expect(
      (await service.ownerCandidates(ada)).map((owner) => owner.id),
    ).toEqual(["ada", "admin", "reader"]);
    expect(await service.ownerCandidates(reader)).toEqual([]);
  });
});
