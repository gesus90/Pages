import { describe, expect, it } from "vitest";

import {
  WikiAccessDeniedError,
  WikiConflictError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import { CAPABILITY } from "@/definition/Authorization";

import type { Database } from "@/backend/database/Database";

import { createWikiHarness, pageInput } from "../helpers/wiki-harness";
import { useMigratedDatabase } from "../helpers/test-database";

async function ageVersions(database: Database): Promise<void> {
  await database.execute(
    "UPDATE wiki_page_versions SET created_at = '2020-01-01 00:00:00';",
  );
}

describe("wiki pages", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const harness = createWikiHarness(getDatabase());
    const ada = await harness.addUser("ada", { displayName: "Ada" });
    const bob = await harness.addUser("bob", { displayName: "Bob" });
    const reader = await harness.addUser("reader", { capabilities: [] });

    return { ...harness, ada, bob, reader };
  }

  it("creates a page whose owner, author and first version are the creator", async () => {
    const { service, ada, repository } = await setup();

    const page = await service.create(
      ada,
      pageInput({ content: "# Hello", icon: "📘", title: "  My   page " }),
    );

    expect(page).toMatchObject({
      content: "# Hello",
      icon: "📘",
      ownerId: "ada",
      ownerName: "Ada",
      parentId: null,
      revision: 1,
      scope: "instance",
      title: "My page",
      updatedByName: "Ada",
    });
    expect(await repository.versions.list(page.id)).toHaveLength(1);
  });

  it("refuses to create without the capability write", async () => {
    const { service, reader } = await setup();

    await expect(service.create(reader, pageInput())).rejects.toBeInstanceOf(
      WikiAccessDeniedError,
    );
  });

  it("validates title, text, icon and place", async () => {
    const { service, ada } = await setup();

    await expect(
      service.create(ada, pageInput({ title: "   " })),
    ).rejects.toMatchObject({ code: "titleRequired" });
    await expect(
      service.create(ada, pageInput({ title: "x".repeat(201) })),
    ).rejects.toMatchObject({ code: "titleTooLong" });
    await expect(
      service.create(ada, pageInput({ content: "x".repeat(200_001) })),
    ).rejects.toMatchObject({ code: "contentTooLong" });
    await expect(
      service.create(ada, pageInput({ icon: "abc" })),
    ).rejects.toMatchObject({ code: "invalidIcon" });
    await expect(
      service.create(ada, pageInput({ scope: null })),
    ).rejects.toMatchObject({ code: "invalidScope" });
    await expect(
      service.create(ada, pageInput({ projectId: "nope", scope: "project" })),
    ).rejects.toMatchObject({ code: "invalidScope" });
    await expect(
      service.create(ada, pageInput({ scope: "project" })),
    ).rejects.toMatchObject({ code: "invalidScope" });
  });

  it("creates project pages and children that inherit the place", async () => {
    const { service, ada, addProject } = await setup();

    await addProject("p1");

    const parent = await service.create(
      ada,
      pageInput({ projectId: "p1", scope: "project" }),
    );
    const child = await service.create(
      ada,
      pageInput({ parentId: parent.id, scope: "instance", title: "Child" }),
    );

    expect(parent).toMatchObject({
      projectId: "p1",
      projectName: "Project p1",
    });
    expect(child).toMatchObject({
      parentId: parent.id,
      projectId: "p1",
      scope: "project",
    });
    expect(child.breadcrumb.map((link) => link.id)).toEqual([parent.id]);
  });

  it("limits the depth of the tree to ten levels", async () => {
    const { service, ada } = await setup();
    let parentId: string | null = null;

    for (let level = 1; level <= 10; level += 1) {
      const page = await service.create(ada, pageInput({ parentId }));

      parentId = page.id;
    }

    await expect(
      service.create(ada, pageInput({ parentId })),
    ).rejects.toMatchObject({ code: "treeTooDeep" });
  });

  it("saves against the revision and reports a conflict", async () => {
    const { service, ada, bob } = await setup();
    const page = await service.create(ada, pageInput({ content: "one" }));

    const saved = await service.update(bob, page.id, {
      content: "two",
      expectedRevision: 1,
      icon: null,
      title: "Page",
    });

    expect(saved).toMatchObject({
      content: "two",
      revision: 2,
      updatedByName: "Bob",
    });

    const error = await service
      .update(ada, page.id, {
        content: "three",
        expectedRevision: 1,
        icon: null,
        title: "Page",
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WikiConflictError);
    expect((error as WikiConflictError).current.content).toBe("two");
  });

  it("keeps the revision when nothing changed", async () => {
    const { service, ada } = await setup();
    const page = await service.create(ada, pageInput({ content: "same" }));

    const saved = await service.update(ada, page.id, {
      content: "same",
      expectedRevision: 1,
      icon: null,
      title: "Page",
    });

    expect(saved.revision).toBe(1);
  });

  it("merges quick saves of one author into one version and keeps others apart", async () => {
    const { service, ada, bob, repository } = await setup();
    const page = await service.create(ada, pageInput({ content: "v1" }));

    await ageVersions(getDatabase());

    const edit = (content: string, revision: number) => ({
      content,
      expectedRevision: revision,
      icon: null,
      title: "Page",
    });

    await service.update(ada, page.id, edit("v2", 1));
    await service.update(ada, page.id, edit("v3", 2));
    await service.update(bob, page.id, edit("v4", 3));

    const versions = await repository.versions.list(page.id);

    expect(versions.map((version) => version.revision)).toEqual([4, 3, 1]);
    expect(versions.map((version) => version.authorId)).toEqual([
      "bob",
      "ada",
      "ada",
    ]);
    expect(versions.map((version) => version.authorName)).toEqual([
      "Bob",
      "Ada",
      "Ada",
    ]);
  });

  it("refuses to save without write or for a hidden page", async () => {
    const { service, ada, reader } = await setup();
    const page = await service.create(ada, pageInput());
    const input = { content: "x", expectedRevision: 1, icon: null, title: "t" };

    await expect(service.update(reader, page.id, input)).rejects.toBeInstanceOf(
      WikiAccessDeniedError,
    );
    await expect(service.update(ada, "missing", input)).rejects.toBeInstanceOf(
      WikiPageNotFoundError,
    );
  });

  it("restores an earlier version as a new one", async () => {
    const { service, ada, repository } = await setup();
    const page = await service.create(ada, pageInput({ content: "first" }));

    await ageVersions(getDatabase());
    await service.update(ada, page.id, {
      content: "second",
      expectedRevision: 1,
      icon: null,
      title: "Page",
    });

    const [, first] = await service.listVersions(ada, page.id);
    const restored = await service.restoreVersion(
      ada,
      page.id,
      first?.id ?? "",
    );

    expect(restored).toMatchObject({ content: "first", revision: 3 });
    expect(await repository.versions.list(page.id)).toHaveLength(3);
    expect(
      (await service.getVersion(ada, page.id, first?.id ?? "")).content,
    ).toBe("first");
    await expect(
      service.restoreVersion(ada, page.id, "missing"),
    ).rejects.toMatchObject({ code: "versionMissing" });
    await expect(
      service.getVersion(ada, page.id, "missing"),
    ).rejects.toMatchObject({ code: "versionMissing" });
  });

  it("creates pages from a template and marks templates", async () => {
    const { service, ada } = await setup();
    const template = await service.create(
      ada,
      pageInput({
        content: "# Plan",
        icon: "📝",
        isTemplate: true,
        title: "T",
      }),
    );
    const page = await service.create(
      ada,
      pageInput({ templateId: template.id, title: "From template" }),
    );

    expect(page).toMatchObject({ content: "# Plan", icon: "📝" });
    expect(await service.templates(ada)).toEqual([
      { icon: "📝", id: template.id, title: "T" },
    ]);
    await expect(
      service.create(ada, pageInput({ templateId: page.id })),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    await expect(
      service.create(ada, pageInput({ parentId: template.id })),
    ).rejects.toMatchObject({ code: "invalidParent" });
  });

  it("sets the current-until date, owner and rejects invalid ones", async () => {
    const { service, ada, bob } = await setup();
    const page = await service.create(ada, pageInput());

    await service.setCurrentUntil(ada, page.id, "2027-02-28");
    expect((await service.read(ada, page.id)).kind).toBe("page");

    await expect(
      service.setCurrentUntil(ada, page.id, "2027-02-30"),
    ).rejects.toMatchObject({ code: "invalidDate" });
    await expect(
      service.setCurrentUntil(ada, page.id, "tomorrow"),
    ).rejects.toMatchObject({ code: "invalidDate" });
    await service.setCurrentUntil(ada, page.id, null);
    await expect(
      service.setCurrentUntil(bob, page.id, "2027-01-01"),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);

    await service.setOwner(ada, page.id, "bob");
    await service.setCurrentUntil(bob, page.id, "2027-01-01");
    await expect(
      service.setOwner(bob, page.id, "ghost"),
    ).rejects.toBeInstanceOf(WikiValidationError);
  });

  it("lets managers of projects, but not writers, manage project pages", async () => {
    const { service, ada, addProject, addUser } = await setup();
    const manager = await addUser("manager", {
      capabilities: [CAPABILITY.WRITE, CAPABILITY.MANAGE_PROJECTS],
    });
    const writer = await addUser("writer");

    await addProject("p1");

    const page = await service.create(
      ada,
      pageInput({ projectId: "p1", scope: "project" }),
    );
    const instancePage = await service.create(ada, pageInput());

    await service.setCurrentUntil(manager, page.id, "2027-01-01");
    await expect(
      service.setCurrentUntil(writer, page.id, "2027-01-01"),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);
    await expect(
      service.setCurrentUntil(manager, instancePage.id, "2027-01-01"),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);
  });
});
