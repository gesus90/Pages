import { describe, expect, it } from "vitest";

import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";
import {
  extractWikiLinks,
  mentionsWikiPage,
} from "@/backend/service/wiki/WikiLinks";
import {
  createSnippet,
  parseSearchText,
} from "@/backend/service/wiki/WikiSearchQuery";

import { useMigratedDatabase } from "../helpers/test-database";
import { createWikiHarness, pageInput } from "../helpers/wiki-harness";

import type { WikiSearchInput } from "@/backend/service/WikiService";

const EMPTY: WikiSearchInput = {
  creatorId: null,
  editedFrom: null,
  editedTo: null,
  location: null,
  sort: null,
  text: "",
  titleOnly: false,
  underPageId: null,
};

describe("search text", () => {
  it("splits words and quoted phrases", () => {
    expect(parseSearchText('alpha "exact phrase" beta "" "open')).toEqual({
      phrases: ["exact phrase"],
      terms: ["alpha", "beta", "open"],
    });
    expect(parseSearchText("   ")).toEqual({ phrases: [], terms: [] });
  });

  it("cuts a passage around the first hit", () => {
    const text = `${"x ".repeat(100)}needle ${"y ".repeat(100)}`;
    const passage = createSnippet(text, ["needle"], 10);

    expect(passage.startsWith("…")).toBe(true);
    expect(passage.endsWith("…")).toBe(true);
    expect(passage).toContain("needle");
    expect(passage.length).toBeLessThan(50);
    expect(createSnippet("needle at start and more text", ["NEEDLE"], 5)).toBe(
      "needle at …",
    );
    expect(createSnippet("short text", ["short"])).toBe("short text");
    expect(createSnippet("only title matched here", ["absent"], 6)).toBe(
      "only title m…",
    );
    expect(createSnippet("a\n\nb", [])).toBe("a b");
    expect(createSnippet("one two", ["two", "one"], 100)).toBe("one two");
  });
});

describe("link extraction", () => {
  it("reads page and ticket addresses once each", () => {
    const content = [
      "[a](/wiki/page-1) and [b](/wiki/page-1/slug) and https://host.example/wiki/page-2#top",
      "![img](/wiki/attachments/file-1) [t](/wiki/trash)",
      "[ticket](/aufgaben/pag-12) and /tasks/PAG-12 and /tasks/OTHER-3.",
      "not /wiki/ nor /wikis/x nor /aufgaben/none",
    ].join("\n");

    expect(extractWikiLinks(content)).toEqual({
      pageIds: ["page-1", "page-2"],
      ticketKeys: ["PAG-12", "OTHER-3"],
    });
  });

  it("checks that an address ends at a word boundary", () => {
    expect(mentionsWikiPage("see /wiki/abc.", "abc")).toBe(true);
    expect(mentionsWikiPage("see /wiki/abcdef", "abc")).toBe(false);
    expect(mentionsWikiPage("see /wiki/abc/slug", "abc")).toBe(true);
  });
});

describe("wiki search and links", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const harness = createWikiHarness(getDatabase());

    await harness.addDepartment("sales");
    await harness.addDepartment("dev");
    await harness.addProject("secret", ["sales"]);
    await harness.addProject("open");

    const ada = await harness.addUser("ada", { departments: ["sales", "dev"] });
    const bob = await harness.addUser("bob", { departments: ["dev"] });
    const admin = await harness.addUser("admin", {
      isAdmin: true,
      mode: "admin",
    });

    return { ...harness, ada, admin, bob };
  }

  it("ranks titles above texts and needs every word", async () => {
    const { ada, service } = await setup();

    await service.create(
      ada,
      pageInput({ content: "the budget plan", title: "Notes" }),
    );
    await service.create(
      ada,
      pageInput({ content: "nothing", title: "Budget" }),
    );
    await service.create(
      ada,
      pageInput({ content: "budget only", title: "Other" }),
    );

    const found = await service.search(ada, { ...EMPTY, text: "budget" });

    expect(found.results[0]?.title).toBe("Budget");
    expect(found.results.map((result) => result.title).sort()).toEqual([
      "Budget",
      "Notes",
      "Other",
    ]);
    expect(found.total).toBe(3);
    expect(
      (
        await service.search(ada, { ...EMPTY, text: "budget plan" })
      ).results.map((r) => r.title),
    ).toEqual(["Notes"]);
    expect(
      (await service.search(ada, { ...EMPTY, text: '"budget plan"' })).total,
    ).toBe(1);
    expect(
      (
        await service.search(ada, { ...EMPTY, text: "budget", titleOnly: true })
      ).results.map((r) => r.title),
    ).toEqual(["Budget"]);
    expect(
      (await service.search(ada, { ...EMPTY, text: "BUDGET plan" })).total,
    ).toBe(1);
  });

  it("treats wildcards literally and returns a passage", async () => {
    const { ada, service } = await setup();

    await service.create(
      ada,
      pageInput({ content: "we reached 100% of the goal", title: "Goal" }),
    );
    await service.create(
      ada,
      pageInput({ content: "one hundred", title: "Plain" }),
    );

    const found = await service.search(ada, { ...EMPTY, text: "100%" });

    expect(found.results.map((result) => result.title)).toEqual(["Goal"]);
    expect(found.results[0]?.snippet).toContain("100% of the goal");

    await service.create(
      ada,
      pageInput({
        content: "# Plan\n\nSee [the **budget** page](/wiki/abc-123) now.",
        title: "Linked",
      }),
    );

    const linked = await service.search(ada, { ...EMPTY, text: "budget" });

    expect(linked.results[0]?.snippet).toBe("Plan See the budget page now.");
    expect((await service.search(ada, { ...EMPTY, text: "_" })).total).toBe(0);
    expect((await service.search(ada, { ...EMPTY, text: "\\" })).total).toBe(0);
  });

  it("finds nothing without words and filters, and everything with filters only", async () => {
    const { ada, service } = await setup();

    await service.create(ada, pageInput({ title: "One" }));

    expect(await service.search(ada, EMPTY)).toEqual({ results: [], total: 0 });
    expect(
      (await service.search(ada, { ...EMPTY, creatorId: "ada" })).total,
    ).toBe(1);
    expect(
      (await service.search(ada, { ...EMPTY, creatorId: "bob" })).total,
    ).toBe(0);
  });

  it("never lets a hidden page into hits, counts or passages", async () => {
    const { ada, bob, admin, service } = await setup();

    await service.create(
      ada,
      pageInput({ content: "secret launch plan", title: "Public launch" }),
    );
    await service.create(
      ada,
      pageInput({
        content: "secret launch budget",
        projectId: "secret",
        scope: "project",
        title: "Project launch",
      }),
    );
    await service.create(
      ada,
      pageInput({
        content: "secret launch diary",
        scope: "private",
        title: "Diary launch",
      }),
    );
    await service.create(
      ada,
      pageInput({
        anchors: [{ kind: "department", targetId: "sales" }],
        content: "secret launch sales",
        title: "Sales launch",
      }),
    );

    const query = { ...EMPTY, text: "launch" };

    expect(
      (await service.search(ada, query)).results.map((r) => r.title).sort(),
    ).toEqual([
      "Diary launch",
      "Project launch",
      "Public launch",
      "Sales launch",
    ]);

    const asBob = await service.search(bob, query);

    expect(asBob.results.map((r) => r.title)).toEqual(["Public launch"]);
    expect(asBob.total).toBe(1);
    expect(JSON.stringify(asBob)).not.toContain("budget");
    expect(
      (await service.search(admin, query)).results.map((r) => r.title).sort(),
    ).toEqual(["Project launch", "Public launch", "Sales launch"]);
  });

  it("filters by area, subtree, dates and sorts", async () => {
    const { ada, service, database } = await setup();
    const parent = await service.create(
      ada,
      pageInput({ content: "topic", title: "Parent" }),
    );
    const child = await service.create(
      ada,
      pageInput({ content: "topic", parentId: parent.id, title: "Child" }),
    );

    await service.create(
      ada,
      pageInput({
        content: "topic",
        projectId: "open",
        scope: "project",
        title: "In project",
      }),
    );
    await service.create(
      ada,
      pageInput({ content: "topic", scope: "private", title: "Mine" }),
    );
    await database.execute(
      "UPDATE wiki_pages SET created_at = '2020-01-01 10:00:00', updated_at = '2020-02-01 10:00:00' WHERE id = $id;",
      { id: child.id },
    );

    const query = { ...EMPTY, text: "topic" };
    const titles = async (overrides: Partial<WikiSearchInput>) =>
      (await service.search(ada, { ...query, ...overrides })).results.map(
        (r) => r.title,
      );

    expect(await titles({ location: "instance" })).toHaveLength(2);
    expect(await titles({ location: "private" })).toEqual(["Mine"]);
    expect(await titles({ location: "project:open" })).toEqual(["In project"]);
    expect(await titles({ location: "project:none" })).toEqual([]);
    expect(await titles({ location: "bogus" })).toHaveLength(4);
    expect((await titles({ underPageId: parent.id })).sort()).toEqual([
      "Child",
      "Parent",
    ]);
    expect(await titles({ editedFrom: "2020-03-01" })).not.toContain("Child");
    expect(await titles({ editedTo: "2020-02-01" })).toEqual(["Child"]);
    expect((await titles({ sort: "created" }))[3]).toBe("Child");
    expect((await titles({ sort: "edited" }))[3]).toBe("Child");
    expect(await titles({ sort: "nonsense" })).toHaveLength(4);
    await expect(
      service.search(ada, { ...query, editedFrom: "soon" }),
    ).rejects.toMatchObject({
      code: "invalidDate",
    });
  });

  it("offers references the person may see", async () => {
    const { ada, admin, bob, service, database } = await setup();

    await service.create(ada, pageInput({ title: "Roadmap" }));
    await service.create(
      ada,
      pageInput({ scope: "private", title: "Road diary" }),
    );
    await database.execute(`
      INSERT INTO work_items (id, project_id, key, number, type, title, status_id, created_by, department_id) VALUES
        ('t1', 'open', 'OPEN-1', 1, 'task', 'Road work', 'status-todo', 'ada', NULL),
        ('t2', 'secret', 'SEC-1', 1, 'task', 'Road secret', 'status-todo', 'ada', NULL);
    `);

    const references = await service.references(bob, "road");

    expect(references).toEqual([
      expect.objectContaining({ kind: "page", title: "Roadmap" }),
      { key: "OPEN-1", kind: "ticket", title: "Road work" },
    ]);
    expect(
      (await service.references(bob, "")).some((r) => r.kind === "person"),
    ).toBe(true);
    expect((await service.references(admin, "sec")).map((r) => r.kind)).toEqual(
      ["ticket"],
    );
    expect(await service.references(bob, "ada")).toEqual([
      { displayName: "ada", id: "ada", kind: "person", username: "ada" },
    ]);
  });

  it("resolves link titles of visible pages only", async () => {
    const { ada, bob, service } = await setup();
    const shared = await service.create(ada, pageInput({ title: "Shared" }));
    const secret = await service.create(
      ada,
      pageInput({ scope: "private", title: "Secret" }),
    );

    expect(
      await service.linkTitles(bob, [shared.id, secret.id, "none"]),
    ).toEqual({
      [shared.id]: "Shared",
    });
    expect(await service.linkTitles(bob, [])).toEqual({});
  });

  it("stores the links of a page and finds the backlinks the person may see", async () => {
    const { ada, admin, bob, service, database } = await setup();
    const target = await service.create(ada, pageInput({ title: "Target" }));
    const visible = await service.create(
      ada,
      pageInput({ content: `see /wiki/${target.id}`, title: "Visible source" }),
    );

    await service.create(
      ada,
      pageInput({
        content: `[x](/wiki/${target.id})`,
        scope: "private",
        title: "Hidden source",
      }),
    );
    await service.create(
      ada,
      pageInput({
        content: `[self](/wiki/${target.id}) /tasks/open-1`,
        parentId: target.id,
        title: "Child source",
      }),
    );
    await database.execute(
      `UPDATE projects SET description = $text WHERE id = 'open';
       UPDATE projects SET description = $other WHERE id = 'secret';
       INSERT INTO work_items (id, project_id, key, number, type, title, description, status_id, created_by) VALUES
         ('t1', 'open', 'OPEN-1', 1, 'task', 'Mentions', $text, 'status-todo', 'ada'),
         ('t2', 'open', 'OPEN-2', 2, 'task', 'Prefix only', $prefix, 'status-todo', 'ada'),
         ('t3', 'secret', 'SEC-1', 1, 'task', 'Hidden', $text, 'status-todo', 'ada');`
        .replaceAll("$text", `'link /wiki/${target.id} end'`)
        .replaceAll("$other", `'/wiki/${target.id}'`)
        .replaceAll("$prefix", `'/wiki/${target.id}more'`),
    );

    const asBob = await service.backlinks(bob, target.id);

    expect(asBob.pages.map((page) => page.title)).toEqual([
      "Child source",
      "Visible source",
    ]);
    expect(asBob.tickets.map((ticket) => ticket.key)).toEqual(["OPEN-1"]);
    expect(asBob.projects).toEqual([{ id: "open", name: "Project open" }]);

    const asAda = await service.backlinks(ada, target.id);

    expect(asAda.pages).toHaveLength(3);
    expect(asAda.tickets.map((ticket) => ticket.key)).toEqual([
      "OPEN-1",
      "SEC-1",
    ]);
    expect(asAda.projects).toHaveLength(2);
    expect((await service.backlinks(admin, target.id)).tickets).toHaveLength(2);
    await expect(service.backlinks(bob, "none")).rejects.toBeInstanceOf(
      WikiPageNotFoundError,
    );

    await service.update(ada, visible.id, {
      content: "no link",
      expectedRevision: 1,
      icon: null,
      title: "Visible source",
    });
    expect(
      (await service.backlinks(bob, target.id)).pages.map((page) => page.title),
    ).toEqual(["Child source"]);
  });

  it("copies the links of a duplicated page", async () => {
    const { ada, service } = await setup();
    const target = await service.create(ada, pageInput({ title: "Target" }));
    const source = await service.create(
      ada,
      pageInput({ content: `/wiki/${target.id}`, title: "Source" }),
    );

    await service.duplicate(ada, source.id, {
      isTemplate: false,
      title: "Copy",
      withChildren: false,
    });

    expect(
      (await service.backlinks(ada, target.id)).pages.map((page) => page.title),
    ).toEqual(["Copy", "Source"]);
  });
});
