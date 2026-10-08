import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
} from "@/backend/error/WikiErrors";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { InstanceSettingsDeniedError } from "@/backend/service/InstanceSettingsService";
import { CAPABILITY } from "@/definition/Authorization";
import { WIKI_SETTING_DEFAULTS } from "@/definition/Wiki";

import { createWikiHarness, pageInput } from "../helpers/wiki-harness";
import { useMigratedDatabase } from "../helpers/test-database";

import type { Database } from "@/backend/database/Database";

async function age(database: Database, id: string, days: number) {
  await database.execute(
    `UPDATE wiki_pages SET deleted_at = strftime(now() - INTERVAL ${days} DAY, '%Y-%m-%d %H:%M:%S') WHERE deleted_root_id = $id;`,
    { id },
  );
}

describe("wiki trash", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const harness = createWikiHarness(getDatabase());
    const ada = await harness.addUser("ada");
    const bob = await harness.addUser("bob");
    const admin = await harness.addUser("admin", {
      isAdmin: true,
      mode: "admin",
    });
    const manager = await harness.addUser("manager", {
      capabilities: [CAPABILITY.WRITE, CAPABILITY.MANAGE_PROJECTS],
    });

    await harness.addProject("p1");

    return { ...harness, ada, admin, bob, manager };
  }

  it("deletes a page with its subtree and restores all of it", async () => {
    const { service, ada } = await setup();
    const parent = await service.create(ada, pageInput({ title: "Parent" }));
    const child = await service.create(
      ada,
      pageInput({ parentId: parent.id, title: "Child" }),
    );

    await service.delete(ada, parent.id);

    expect((await service.navigation(ada)).nodes).toEqual([]);
    await expect(service.read(ada, child.id)).rejects.toBeInstanceOf(
      WikiPageNotFoundError,
    );
    expect((await service.listTrash(ada)).map((entry) => entry.title)).toEqual([
      "Parent",
    ]);

    await service.restore(ada, parent.id);

    expect(
      (await service.navigation(ada)).nodes.map((n) => n.title).sort(),
    ).toEqual(["Child", "Parent"]);
  });

  it("restores a page whose parent is gone as a root page", async () => {
    const { service, ada } = await setup();
    const parent = await service.create(ada, pageInput({ title: "Parent" }));
    const child = await service.create(
      ada,
      pageInput({ parentId: parent.id, title: "Child" }),
    );

    await service.delete(ada, child.id);
    await service.delete(ada, parent.id);
    await service.restore(ada, child.id);

    const restored = await service.read(ada, child.id);

    expect(restored.kind === "page" && restored.view.page.parentId).toBeNull();

    await service.restore(ada, parent.id);

    const nodes = (await service.navigation(ada)).nodes;

    expect(nodes.find((node) => node.id === child.id)?.parentId).toBeNull();
  });

  it("restores below a parent that is still alive", async () => {
    const { service, ada } = await setup();
    const parent = await service.create(ada, pageInput({ title: "Parent" }));
    const child = await service.create(
      ada,
      pageInput({ parentId: parent.id, title: "Child" }),
    );

    await service.delete(ada, child.id);
    await service.restore(ada, child.id);

    const restored = await service.read(ada, child.id);

    expect(restored.kind === "page" && restored.view.page.parentId).toBe(
      parent.id,
    );
  });

  it("lets only managers delete and restore", async () => {
    const { service, ada, bob, manager, admin } = await setup();
    const page = await service.create(ada, pageInput());
    const projectPage = await service.create(
      ada,
      pageInput({ projectId: "p1", scope: "project" }),
    );

    await expect(service.delete(bob, page.id)).rejects.toBeInstanceOf(
      WikiAccessDeniedError,
    );
    await service.delete(manager, projectPage.id);
    expect((await service.listTrash(manager)).map((e) => e.id)).toEqual([
      projectPage.id,
    ]);
    expect(await service.listTrash(bob)).toEqual([]);
    await expect(service.restore(bob, projectPage.id)).rejects.toBeInstanceOf(
      WikiAccessDeniedError,
    );
    await service.restore(admin, projectPage.id);
    await service.delete(admin, page.id);
    await expect(service.restore(ada, "missing")).rejects.toBeInstanceOf(
      WikiPageNotFoundError,
    );
  });

  it("refuses to restore a page that is not a deleted root", async () => {
    const { service, ada } = await setup();
    const parent = await service.create(ada, pageInput({ title: "Parent" }));
    const child = await service.create(
      ada,
      pageInput({ parentId: parent.id, title: "Child" }),
    );

    await service.delete(ada, parent.id);

    await expect(service.restore(ada, child.id)).rejects.toMatchObject({
      code: "notInTrash",
    });
    await expect(service.purge(ada, parent.id)).resolves.toBeUndefined();
    await expect(service.purge(ada, parent.id)).rejects.toBeInstanceOf(
      WikiPageNotFoundError,
    );
  });

  it("lets an administrator delete a private page into the owner's trash only", async () => {
    const { service, ada, admin } = await setup();
    const page = await service.create(
      ada,
      pageInput({ scope: "private", title: "Diary" }),
    );

    await service.deletePrivateAsAdministrator(admin, page.id);

    expect(await service.listTrash(admin)).toEqual([]);
    expect((await service.listTrash(ada)).map((entry) => entry.title)).toEqual([
      "Diary",
    ]);
    await expect(service.restore(admin, page.id)).rejects.toBeInstanceOf(
      WikiPageNotFoundError,
    );
    await expect(
      service.deletePrivateAsAdministrator(admin, page.id),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    await expect(
      service.deletePrivateAsAdministrator(ada, page.id),
    ).rejects.toBeInstanceOf(WikiPageNotFoundError);
    await service.restore(ada, page.id);
    expect((await service.read(ada, page.id)).kind).toBe("page");
  });

  it("removes expired pages for good, including everything attached to them", async () => {
    const { service, ada, database, filesDirectory } = await setup();

    writeFileSync(path.join(filesDirectory, "stored-1"), "bytes");
    const keep = await service.create(ada, pageInput({ title: "Keep" }));
    const gone = await service.create(ada, pageInput({ title: "Gone" }));

    await database.execute(
      `
        INSERT INTO wiki_attachments (id, page_id, file_name, content_type, kind, size, checksum, storage_name, uploaded_by)
        VALUES ('a1', $page_id, 'f.txt', 'text/plain', 'file', 1, 'x', 'stored-1', 'ada');
        INSERT INTO wiki_comments (id, page_id, author_id, body) VALUES ('c1', $page_id, 'ada', 'hi');
        INSERT INTO wiki_page_links VALUES ($keep_id, 'page', $page_id);
      `
        .replaceAll("$page_id", `'${gone.id}'`)
        .replaceAll("$keep_id", `'${keep.id}'`),
    );
    await service.delete(ada, gone.id);
    await service.delete(ada, keep.id);
    await age(database, gone.id, 31);

    await service.runMaintenance();

    expect(existsSync(path.join(filesDirectory, "stored-1"))).toBe(false);
    expect((await service.listTrash(ada)).map((entry) => entry.title)).toEqual([
      "Keep",
    ]);
    expect(await database.query("SELECT COUNT(*) FROM wiki_comments;")).toEqual(
      [[0]],
    );
    expect(
      await database.query("SELECT COUNT(*) FROM wiki_page_links;"),
    ).toEqual([[0]]);
  });

  it("purges one page from the trash on request and removes its files", async () => {
    const { service, ada, database, filesDirectory } = await setup();

    writeFileSync(path.join(filesDirectory, "stored-2"), "bytes");
    const page = await service.create(ada, pageInput());

    await database.execute(
      `INSERT INTO wiki_attachments (id, page_id, file_name, content_type, kind, size, checksum, storage_name, uploaded_by)
       VALUES ('a1', '${page.id}', 'f.txt', 'text/plain', 'file', 1, 'x', 'stored-2', 'ada');`,
    );
    await service.delete(ada, page.id);

    await service.purge(ada, page.id);

    expect(existsSync(path.join(filesDirectory, "stored-2"))).toBe(false);
    expect(await service.listTrash(ada)).toEqual([]);
  });

  it("prunes versions beyond both the age and the count limit", async () => {
    const { service, ada, bob, admin, database } = await setup();
    const page = await service.create(ada, pageInput({ content: "0" }));

    await database.execute(
      "UPDATE wiki_page_versions SET created_at = '2020-01-01 00:00:00';",
    );

    for (let index = 1; index <= 3; index += 1) {
      const author = index % 2 === 0 ? ada : bob;

      await service.update(author, page.id, {
        content: String(index),
        expectedRevision: index,
        icon: null,
        title: "Page",
      });
      await database.execute(
        "UPDATE wiki_page_versions SET created_at = '2020-01-0' || $index || ' 00:00:00' WHERE revision = $revision;",
        { index: String(index + 1), revision: index + 1 },
      );
    }

    await service.updateSettings(admin, {
      ...WIKI_SETTING_DEFAULTS,
      versionKeepLast: 2,
    });

    await service.runMaintenance();

    const remaining = await service.listVersions(ada, page.id);

    expect(remaining.map((version) => version.revision)).toEqual([4, 3]);
  });

  it("keeps young versions beyond the count limit", async () => {
    const { service, ada, bob, admin } = await setup();
    const page = await service.create(ada, pageInput({ content: "0" }));

    await service.update(bob, page.id, {
      content: "1",
      expectedRevision: 1,
      icon: null,
      title: "Page",
    });
    await service.updateSettings(admin, {
      ...WIKI_SETTING_DEFAULTS,
      versionKeepLast: 1,
    });
    await service.runMaintenance();

    expect(await service.listVersions(ada, page.id)).toHaveLength(2);
  });

  it("reads defaults, validates and stores the settings for administrators only", async () => {
    const { service, ada, admin } = await setup();

    expect(await service.getSettings()).toEqual(WIKI_SETTING_DEFAULTS);

    const changed = { ...WIKI_SETTING_DEFAULTS, trashRetentionDays: 7 };

    await service.updateSettings(admin, changed);
    expect(await service.getSettings()).toEqual(changed);
    await expect(service.updateSettings(ada, changed)).rejects.toBeInstanceOf(
      InstanceSettingsDeniedError,
    );
    await expect(
      service.updateSettings(admin, { ...changed, trashRetentionDays: 0 }),
    ).rejects.toMatchObject({ code: "invalidSetting" });
    await expect(
      service.updateSettings(admin, { ...changed, mediaLimitBytes: 1.5 }),
    ).rejects.toMatchObject({ code: "invalidSetting" });
    await expect(
      service.updateSettings(admin, { ...changed, fileLimitBytes: 10 ** 15 }),
    ).rejects.toMatchObject({ code: "invalidSetting" });
  });

  it("deletes the pages of a deleted project for good", async () => {
    const { service, ada, database } = await setup();

    await service.create(
      ada,
      pageInput({ projectId: "p1", scope: "project", title: "In project" }),
    );
    await service.create(ada, pageInput({ title: "Elsewhere" }));
    await database.execute(
      "UPDATE projects SET archived_at = utc_now() WHERE id = 'p1';",
    );

    await new ProjectRepository(database).deletePermanently("p1");

    expect((await service.navigation(ada)).nodes.map((n) => n.title)).toEqual([
      "Elsewhere",
    ]);
    expect(await database.query("SELECT COUNT(*) FROM wiki_pages;")).toEqual([
      [1],
    ]);
  });
});
