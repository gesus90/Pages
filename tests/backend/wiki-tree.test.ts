import { describe, expect, it } from "vitest";

import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
} from "@/backend/error/WikiErrors";
import { CAPABILITY } from "@/definition/Authorization";
import { compareAudience } from "@/definition/Wiki";

import { createWikiHarness, pageInput } from "../helpers/wiki-harness";
import { useMigratedDatabase } from "../helpers/test-database";

import type { User } from "@/definition/User";
import type { WikiService } from "@/backend/service/WikiService";

async function titles(
  service: WikiService,
  actor: User,
  parentId: string | null,
) {
  const { nodes } = await service.navigation(actor);

  return nodes
    .filter((node) => node.parentId === parentId)
    .map((node) => node.title);
}

describe("wiki tree", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const harness = createWikiHarness(getDatabase());

    await harness.addDepartment("sales");

    const ada = await harness.addUser("ada", { departments: ["sales"] });
    const bob = await harness.addUser("bob");

    await harness.addProject("p1");
    await harness.addProject("p2");
    await harness.addMilestone("m1", "p1");

    return { ...harness, ada, bob };
  }

  it("orders siblings and moves a page before a sibling", async () => {
    const { service, ada } = await setup();
    const first = await service.create(ada, pageInput({ title: "A" }));

    await service.create(ada, pageInput({ title: "B" }));

    const third = await service.create(ada, pageInput({ title: "C" }));

    expect(await titles(service, ada, null)).toEqual(["A", "B", "C"]);

    await service.move(ada, third.id, {
      beforeId: first.id,
      parentId: null,
      projectId: null,
      scope: "instance",
    });

    expect(await titles(service, ada, null)).toEqual(["C", "A", "B"]);
    await expect(
      service.move(ada, third.id, {
        beforeId: "missing",
        parentId: null,
        projectId: null,
        scope: "instance",
      }),
    ).rejects.toMatchObject({ code: "invalidPosition" });
  });

  it("moves a subtree into a project and drops anchors that belong to the old project", async () => {
    const { service, ada, repository } = await setup();
    const root = await service.create(
      ada,
      pageInput({
        anchors: [
          { kind: "department", targetId: "sales" },
          { kind: "milestone", targetId: "m1" },
        ],
        title: "Root",
      }),
    );
    const child = await service.create(
      ada,
      pageInput({
        anchors: [{ kind: "milestone", targetId: "m1" }],
        parentId: root.id,
        title: "Child",
      }),
    );

    await service.move(ada, root.id, {
      beforeId: null,
      parentId: null,
      projectId: "p2",
      scope: "project",
    });

    const moved = await service.read(ada, child.id);

    expect(moved.kind === "page" && moved.view.page).toMatchObject({
      projectId: "p2",
      scope: "project",
    });
    expect(await repository.anchors.findAnchors(root.id)).toEqual([
      { kind: "department", label: "Department sales", targetId: "sales" },
    ]);
    expect(await repository.anchors.findAnchors(child.id)).toEqual([]);
  });

  it("keeps anchors when only the parent changes within one project", async () => {
    const { service, ada, repository } = await setup();
    const parent = await service.create(ada, pageInput({ title: "P" }));
    const page = await service.create(
      ada,
      pageInput({
        anchors: [{ kind: "milestone", targetId: "m1" }],
        title: "Q",
      }),
    );

    await service.move(ada, page.id, {
      beforeId: null,
      parentId: parent.id,
      projectId: null,
      scope: null,
    });

    expect(await repository.anchors.findAnchors(page.id)).toHaveLength(1);
  });

  it("clears every anchor when a page becomes private", async () => {
    const { service, ada, repository } = await setup();
    const page = await service.create(
      ada,
      pageInput({ anchors: [{ kind: "department", targetId: "sales" }] }),
    );

    await expect(
      service.create(
        ada,
        pageInput({
          anchors: [{ kind: "department", targetId: "sales" }],
          scope: "private",
        }),
      ),
    ).rejects.toMatchObject({ code: "invalidAnchor" });
    await service.move(ada, page.id, {
      beforeId: null,
      parentId: null,
      projectId: null,
      scope: "private",
    });

    expect(await repository.anchors.findAnchors(page.id)).toEqual([]);
  });

  it("rejects cycles, templates, foreign private targets and deep moves", async () => {
    const { service, ada, bob } = await setup();
    const parent = await service.create(ada, pageInput({ title: "P" }));
    const child = await service.create(
      ada,
      pageInput({ parentId: parent.id, title: "C" }),
    );
    const secret = await service.create(
      bob,
      pageInput({ scope: "private", title: "S" }),
    );
    const move = (id: string, parentId: string | null) =>
      service.move(ada, id, {
        beforeId: null,
        parentId,
        projectId: null,
        scope: "instance",
      });

    await expect(move(parent.id, child.id)).rejects.toMatchObject({
      code: "invalidParent",
    });
    await expect(move(parent.id, parent.id)).rejects.toMatchObject({
      code: "invalidParent",
    });
    await expect(move(parent.id, secret.id)).rejects.toBeInstanceOf(
      WikiPageNotFoundError,
    );

    let tail = child.id;

    for (let level = 3; level <= 10; level += 1) {
      tail = (await service.create(ada, pageInput({ parentId: tail }))).id;
    }

    const lone = await service.create(ada, pageInput({ title: "Lone" }));

    await expect(move(lone.id, tail)).rejects.toMatchObject({
      code: "treeTooDeep",
    });
  });

  it("lets only managers move pages and only owners make pages private", async () => {
    const { service, ada, bob } = await setup();
    const page = await service.create(ada, pageInput());
    const input = {
      beforeId: null,
      parentId: null,
      projectId: null,
    } as const;

    await expect(
      service.move(bob, page.id, { ...input, scope: "instance" }),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);
    await expect(
      service.previewMove(bob, page.id, { ...input, scope: "instance" }),
    ).rejects.toBeInstanceOf(WikiAccessDeniedError);
    await expect(
      service.move(ada, page.id, { ...input, scope: "bogus" as never }),
    ).rejects.toMatchObject({ code: "invalidScope" });
  });

  it("refuses a private move by a manager who is not the owner", async () => {
    const { service, ada, addUser, addProject } = await setup();
    const manager = await addUser("manager", {
      capabilities: [CAPABILITY.WRITE, CAPABILITY.MANAGE_PROJECTS],
    });

    await addProject("p3");

    const page = await service.create(
      ada,
      pageInput({ projectId: "p3", scope: "project" }),
    );

    await expect(
      service.move(manager, page.id, {
        beforeId: null,
        parentId: null,
        projectId: null,
        scope: "private",
      }),
    ).rejects.toMatchObject({ code: "invalidScope" });
  });

  it("tells how a move changes the audience without naming anybody", async () => {
    const { service, ada } = await setup();
    const page = await service.create(ada, pageInput());
    const preview = (
      scope: "instance" | "project" | "private",
      projectId: string | null,
    ) =>
      service.previewMove(ada, page.id, {
        beforeId: null,
        parentId: null,
        projectId,
        scope,
      });

    expect(await preview("instance", null)).toBe("same");
    expect(await preview("private", null)).toBe("narrower");
    expect(await preview("project", "p1")).toBe("narrower");
    expect(
      compareAudience(
        { projectId: null, scope: "private" },
        { projectId: null, scope: "instance" },
      ),
    ).toBe("wider");
    expect(
      compareAudience(
        { projectId: "p1", scope: "project" },
        { projectId: "p2", scope: "project" },
      ),
    ).toBe("different");
  });

  it("tells that the anchors of the new parent change the audience", async () => {
    const { service, addDepartment, addUser } = await setup();

    await addDepartment("hr");

    const ada = await addUser("cy", { departments: ["sales", "hr"] });

    const anchored = await service.create(
      ada,
      pageInput({
        anchors: [{ kind: "department", targetId: "hr" }],
        title: "Anchored",
      }),
    );
    const other = await service.create(
      ada,
      pageInput({
        anchors: [{ kind: "department", targetId: "sales" }],
        title: "Other",
      }),
    );
    const plain = await service.create(ada, pageInput({ title: "Plain" }));
    const inside = await service.create(
      ada,
      pageInput({ parentId: anchored.id, title: "Inside" }),
    );
    const preview = (id: string, parentId: string | null) =>
      service.previewMove(ada, id, {
        beforeId: null,
        parentId,
        projectId: null,
        scope: "instance",
      });

    expect(await preview(plain.id, anchored.id)).toBe("narrower");
    expect(await preview(inside.id, null)).toBe("wider");
    expect(await preview(inside.id, other.id)).toBe("different");
    expect(await preview(inside.id, anchored.id)).toBe("same");
    expect(await preview(plain.id, null)).toBe("same");

    const deeper = await service.create(
      ada,
      pageInput({ parentId: inside.id, title: "Deeper" }),
    );

    expect(await preview(deeper.id, plain.id)).toBe("wider");
  });

  it("duplicates a page with or without its visible children", async () => {
    const { service, ada, bob, addDepartment } = await setup();

    await addDepartment("hr");

    const insider = await service.create(
      ada,
      pageInput({ title: "Root", content: "text", icon: "📘" }),
    );

    await service.create(ada, pageInput({ parentId: insider.id, title: "K1" }));

    const hidden = await service.create(
      ada,
      pageInput({ parentId: insider.id, title: "Hidden" }),
    );

    await getDatabase().execute(
      "INSERT INTO wiki_page_anchors VALUES ($id, 'department', 'hr');",
      { id: hidden.id },
    );

    const plain = await service.duplicate(bob, insider.id, {
      isTemplate: false,
      title: "Copy",
      withChildren: false,
    });
    const deep = await service.duplicate(bob, insider.id, {
      isTemplate: false,
      title: "Deep copy",
      withChildren: true,
    });

    expect(plain).toMatchObject({
      content: "text",
      ownerId: "bob",
      title: "Copy",
    });
    expect(await titles(service, bob, plain.id)).toEqual([]);
    expect(await titles(service, bob, deep.id)).toEqual(["K1"]);

    const template = await service.duplicate(bob, insider.id, {
      isTemplate: true,
      title: "Template",
      withChildren: false,
    });

    expect((await service.templates(bob)).map((entry) => entry.id)).toEqual([
      template.id,
    ]);
  });

  it("copies the anchors of a duplicated page unless their target is gone", async () => {
    const { service, ada, repository } = await setup();
    const page = await service.create(
      ada,
      pageInput({ anchors: [{ kind: "milestone", targetId: "m1" }] }),
    );
    const copy = await service.duplicate(ada, page.id, {
      isTemplate: false,
      title: "Copy",
      withChildren: false,
    });

    expect(await repository.anchors.findAnchors(copy.id)).toHaveLength(1);
  });

  it("builds the navigation with projects, favorites, open branches and recent pages", async () => {
    const { service, ada, bob } = await setup();
    const page = await service.create(ada, pageInput({ title: "Home" }));
    const other = await service.create(ada, pageInput({ title: "Other" }));

    await service.setFavorite(ada, page.id, true);
    await service.setFavorite(ada, page.id, true);
    await service.setExpanded(ada, page.id, true);
    await service.read(ada, other.id);
    await getDatabase().execute(
      "UPDATE wiki_recent_pages SET visited_at = '2020-01-01 00:00:00';",
    );
    await service.read(ada, page.id);

    const navigation = await service.navigation(ada);

    expect(navigation.favoriteIds).toEqual([page.id]);
    expect(navigation.expandedIds).toEqual([page.id]);
    expect(navigation.recent.map((entry) => entry.title)).toEqual([
      "Home",
      "Other",
    ]);
    expect(navigation.projects.map((project) => project.id)).toEqual([
      "p1",
      "p2",
    ]);
    expect(navigation.canCreate).toBe(true);

    await service.setFavorite(ada, page.id, false);
    await service.setExpanded(ada, page.id, false);

    expect((await service.navigation(ada)).favoriteIds).toEqual([]);
    await expect(
      service.setFavorite(bob, "missing", true),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    await expect(
      service.setExpanded(bob, "missing", true),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
  });

  it("keeps only the last twenty recent pages and shows no hidden ones", async () => {
    const { service, ada, bob } = await setup();
    const ids: string[] = [];

    for (let index = 0; index < 22; index += 1) {
      const page = await service.create(ada, pageInput({ title: `P${index}` }));

      ids.push(page.id);
      await service.read(ada, page.id);
    }

    expect((await service.navigation(ada)).recent).toHaveLength(20);

    const secret = await service.create(
      bob,
      pageInput({ scope: "private", title: "Secret" }),
    );

    await service.read(bob, secret.id);
    await getDatabase().execute(
      "INSERT INTO wiki_recent_pages (user_id, page_id) VALUES ('ada', $id);",
      { id: secret.id },
    );

    expect(
      (await service.navigation(ada)).recent.some(
        (entry) => entry.id === secret.id,
      ),
    ).toBe(false);
  });

  it("lists the start page: recently edited, mine, favorites and all", async () => {
    const { service, ada, bob } = await setup();
    const page = await service.create(ada, pageInput({ title: "Mine" }));

    await service.create(bob, pageInput({ title: "Theirs" }));
    await service.setFavorite(ada, page.id, true);

    const home = await service.home(ada);

    expect(home.all).toHaveLength(2);
    expect(home.mine.map((entry) => entry.title)).toEqual(["Mine"]);
    expect(home.favorites.map((entry) => entry.title)).toEqual(["Mine"]);
    expect(home.recentlyEdited).toHaveLength(2);
  });

  it("reads children in order and the page rights of the viewer", async () => {
    const { service, ada, bob, addUser } = await setup();
    const reader = await addUser("reader", { capabilities: [] });
    const parent = await service.create(ada, pageInput());

    await service.create(ada, pageInput({ parentId: parent.id, title: "One" }));
    await service.create(ada, pageInput({ parentId: parent.id, title: "Two" }));

    const view = await service.read(reader, parent.id);

    expect(
      view.kind === "page" && view.view.children.map((c) => c.title),
    ).toEqual(["One", "Two"]);
    expect(view.kind === "page" && view.view.permissions).toEqual({
      canComment: true,
      canEdit: false,
      canManage: false,
    });
    expect((await service.read(bob, parent.id)).kind).toBe("page");
  });
});
