import { describe, expect, it } from "vitest";

import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";
import { CAPABILITY } from "@/definition/Authorization";

import { createWikiHarness, pageInput } from "../helpers/wiki-harness";
import { useMigratedDatabase } from "../helpers/test-database";

import type { User } from "@/definition/User";
import type { WikiService } from "@/backend/service/WikiService";

async function visibleTitles(service: WikiService, actor: User) {
  return (await service.navigation(actor)).nodes
    .map((node) => node.title)
    .sort();
}

describe("wiki visibility", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const harness = createWikiHarness(getDatabase());

    await harness.addDepartment("sales");
    await harness.addDepartment("dev");
    await harness.addProject("secret", ["sales"]);
    await harness.addProject("open");
    await harness.addMilestone("m-secret", "secret");
    await harness.addMilestone("m-open", "open");
    await harness.addEpic("e-secret", "secret");
    await harness.addEpic("e-dev", "open", "dev");

    const author = await harness.addUser("author", {
      capabilities: [CAPABILITY.WRITE],
      departments: ["sales", "dev"],
    });
    const sales = await harness.addUser("sales-person", {
      departments: ["sales"],
    });
    const dev = await harness.addUser("dev-person", { departments: ["dev"] });
    const outsider = await harness.addUser("outsider", { departments: [] });
    const admin = await harness.addUser("admin", {
      isAdmin: true,
      mode: "admin",
    });
    const adminAsRole = await harness.addUser("admin-role", {
      isAdmin: true,
      mode: "role",
    });

    return { ...harness, admin, adminAsRole, author, dev, outsider, sales };
  }

  it("shows instance pages to everyone and project pages only with project access", async () => {
    const { service, author, sales, outsider } = await setup();

    await service.create(author, pageInput({ title: "For all" }));
    await service.create(
      author,
      pageInput({ projectId: "secret", scope: "project", title: "Secret" }),
    );
    await service.create(
      author,
      pageInput({ projectId: "open", scope: "project", title: "Open" }),
    );

    expect(await visibleTitles(service, sales)).toEqual([
      "For all",
      "Open",
      "Secret",
    ]);
    expect(await visibleTitles(service, outsider)).toEqual(["For all", "Open"]);
  });

  it("hides a page behind a department anchor from other departments", async () => {
    const { service, author, dev, sales } = await setup();
    const page = await service.create(
      author,
      pageInput({
        anchors: [{ kind: "department", targetId: "sales" }],
        title: "Sales only",
      }),
    );

    expect(await visibleTitles(service, sales)).toEqual(["Sales only"]);
    expect(await visibleTitles(service, dev)).toEqual([]);
    await expect(service.read(dev, page.id)).rejects.toBeInstanceOf(
      WikiPageNotFoundError,
    );
  });

  it("applies milestone and epic anchors through project and ticket visibility", async () => {
    const { service, author, sales, dev, outsider } = await setup();

    await service.create(
      author,
      pageInput({
        anchors: [{ kind: "milestone", targetId: "m-secret" }],
        title: "Milestone page",
      }),
    );
    await service.create(
      author,
      pageInput({
        anchors: [{ kind: "epic", targetId: "e-dev" }],
        title: "Epic page",
      }),
    );

    expect(await visibleTitles(service, sales)).toEqual(["Milestone page"]);
    expect(await visibleTitles(service, dev)).toEqual(["Epic page"]);
    expect(await visibleTitles(service, outsider)).toEqual([]);
  });

  it("hides the whole subtree of a hidden page and requires every anchor", async () => {
    const { service, author, sales, dev } = await setup();
    const parent = await service.create(
      author,
      pageInput({
        anchors: [{ kind: "department", targetId: "sales" }],
        title: "Parent",
      }),
    );

    await service.create(
      author,
      pageInput({ parentId: parent.id, title: "Child" }),
    );
    await service.create(
      author,
      pageInput({
        anchors: [
          { kind: "department", targetId: "sales" },
          { kind: "department", targetId: "dev" },
        ],
        title: "Both",
      }),
    );

    expect(await visibleTitles(service, sales)).toEqual(["Child", "Parent"]);
    expect(await visibleTitles(service, dev)).toEqual([]);
  });

  it("shows private pages to their owner only and administrators get a placeholder", async () => {
    const { service, author, admin, adminAsRole, sales } = await setup();
    const page = await service.create(
      author,
      pageInput({ content: "diary", scope: "private", title: "Diary" }),
    );

    expect(await visibleTitles(service, author)).toEqual(["Diary"]);
    expect(await visibleTitles(service, sales)).toEqual([]);
    expect(await visibleTitles(service, admin)).toEqual([]);
    await expect(service.read(sales, page.id)).rejects.toBeInstanceOf(
      WikiPageNotFoundError,
    );
    await expect(service.read(adminAsRole, page.id)).rejects.toBeInstanceOf(
      WikiPageNotFoundError,
    );
    expect(await service.read(admin, page.id)).toEqual({
      kind: "placeholder",
      placeholder: { id: page.id, ownerId: "author", ownerName: "author" },
    });
    await expect(service.read(admin, "missing")).rejects.toBeInstanceOf(
      WikiPageNotFoundError,
    );
  });

  it("keeps administrators out of department anchored pages only in role mode", async () => {
    const { service, author, admin, adminAsRole } = await setup();

    await service.create(
      author,
      pageInput({
        anchors: [{ kind: "department", targetId: "sales" }],
        title: "Sales only",
      }),
    );

    expect(await visibleTitles(service, admin)).toEqual(["Sales only"]);
    expect(await visibleTitles(service, adminAsRole)).toEqual([]);
  });

  it("hides a page whose anchor target vanished from everybody but owner and administrators", async () => {
    const { service, database, author, sales, admin } = await setup();

    await service.create(
      author,
      pageInput({
        anchors: [{ kind: "milestone", targetId: "m-open" }],
        title: "Dangling milestone",
      }),
    );
    await service.create(
      author,
      pageInput({
        anchors: [{ kind: "epic", targetId: "e-dev" }],
        title: "Dangling epic",
      }),
    );
    await service.create(
      author,
      pageInput({
        anchors: [{ kind: "department", targetId: "dev" }],
        title: "Dangling department",
      }),
    );
    await database.execute("DELETE FROM milestones WHERE id = 'm-open';");
    await database.execute("DELETE FROM work_items WHERE id = 'e-dev';");
    await database.execute("DELETE FROM departments WHERE id = 'dev';");

    expect(await visibleTitles(service, sales)).toEqual([]);
    expect(await visibleTitles(service, author)).toHaveLength(3);
    expect(await visibleTitles(service, admin)).toHaveLength(3);
  });

  it("lists placeholders only for administrators in the admin mode", async () => {
    const { service, author, admin, adminAsRole } = await setup();
    const first = await service.create(
      author,
      pageInput({ scope: "private", title: "One" }),
    );

    await service.create(author, pageInput({ title: "Public" }));

    expect(await service.listPlaceholders(admin, "author")).toEqual([
      { id: first.id, ownerId: "author", ownerName: "author" },
    ]);
    expect(await service.listPlaceholders(adminAsRole, "author")).toEqual([]);
    expect(await service.findPlaceholder(adminAsRole, first.id)).toBeNull();
    expect(await service.findPlaceholder(admin, "missing")).toBeNull();
  });

  it("groups the placeholders of every account for the user management", async () => {
    const { service, author, admin, adminAsRole } = await setup();
    const page = await service.create(
      author,
      pageInput({ scope: "private", title: "Secret" }),
    );

    await service.create(author, pageInput({ title: "Public" }));

    expect(await service.listAllPlaceholders(admin)).toEqual({
      author: [{ id: page.id, ownerId: "author", ownerName: "author" }],
    });
    expect(await service.listAllPlaceholders(adminAsRole)).toEqual({});
    expect(await service.listAllPlaceholders(author)).toEqual({});
  });
});
