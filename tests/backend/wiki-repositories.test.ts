import { describe, expect, it } from "vitest";

import { WikiAnchorRepository } from "@/backend/database/repositories/wiki/WikiAnchorRepository";
import { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import { WikiPageRepository } from "@/backend/database/repositories/wiki/WikiPageRepository";
import { WikiPageWriteRepository } from "@/backend/database/repositories/wiki/WikiPageWriteRepository";
import {
  readCount,
  readPageRecord,
  readScope,
} from "@/backend/database/repositories/wiki/WikiPageRows";
import { WikiVersionRepository } from "@/backend/database/repositories/wiki/WikiVersionRepository";
import { createVisiblePagesQuery } from "@/backend/database/repositories/wiki/WikiVisibility";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { canManagePage, WikiAccess } from "@/backend/service/wiki/WikiAccess";
import { WikiValidationError } from "@/backend/error/WikiErrors";
import { validateAnchors } from "@/backend/service/wiki/WikiAnchorValidator";
import { CAPABILITY } from "@/definition/Authorization";

import { createDatabase } from "../helpers/factories";
import { createWikiHarness, pageInput } from "../helpers/wiki-harness";
import { useMigratedDatabase } from "../helpers/test-database";

import type { WikiViewer } from "@/backend/service/wiki/WikiAccess";
import type { WikiVisibilityScope } from "@/definition/Wiki";

const SCOPE: WikiVisibilityScope = {
  departmentIds: [],
  isAdmin: false,
  projectIds: [],
  userId: "u",
};

describe("wiki row mapping", () => {
  it("rejects values the schema cannot produce", () => {
    expect(() => readScope(["galaxy"], 0)).toThrow('"scope"');
    expect(() => readCount(["1"], 0, "revision")).toThrow('"revision"');
    expect(readCount([BigInt(3)], 0, "revision")).toBe(3);
    expect(() => readPageRecord([])).toThrow();
  });
});

describe("wiki repositories on empty answers", () => {
  it("tolerates queries that return nothing", async () => {
    const database = createDatabase();

    database.query.mockResolvedValue([]);

    const pages = new WikiPageRepository(database);
    const writes = new WikiPageWriteRepository(database);

    expect(await pages.countLevelsBelow("x")).toBe(0);
    expect(
      await writes.nextPosition(
        { parentId: null, projectId: null, scope: "instance" },
        "u",
      ),
    ).toBe(1);
    expect(
      await writes.saveEdit("x", {
        content: "",
        editorId: "u",
        icon: null,
        title: "t",
      }),
    ).toBe(0);
    expect(await new WikiLookupRepository(database).findUserName("x")).toBe("");
    expect(await new WikiLookupRepository(database).isActiveUser("x")).toBe(
      false,
    );
    expect(await new WikiVersionRepository(database).find("p", "v")).toBeNull();
    expect(
      await new WikiAnchorRepository(database).findAnchorTarget("epic", "x"),
    ).toBeNull();
  });

  it("rejects an anchor kind the schema cannot produce", async () => {
    const database = createDatabase();

    database.query.mockResolvedValue([["galaxy", "t", null]]);

    await expect(
      new WikiAnchorRepository(database).findAnchors("p"),
    ).rejects.toThrow('"kind"');
  });

  it("builds a visibility query for an empty scope", () => {
    const query = createVisiblePagesQuery(SCOPE, { includeDeleted: true });

    expect(query.sql).toContain("WITH RECURSIVE visible_pages");
    expect(query.sql).toContain("FALSE");
    expect(query.parameters).toMatchObject({
      viewer_id: "u",
      viewer_is_admin: 0,
    });
  });
});

describe("wiki repository facade and lookups", () => {
  const getDatabase = useMigratedDatabase();

  it("runs nested transactions inside the open one", async () => {
    const repository = new WikiRepository(getDatabase());

    const result = await repository.transaction((outer) =>
      (
        outer as unknown as {
          database: { transaction: <T>(work: () => Promise<T>) => Promise<T> };
        }
      ).database.transaction(async () => "nested"),
    );

    expect(result).toBe("nested");
  });

  it("names projects and counts private pages per owner", async () => {
    const harness = createWikiHarness(getDatabase());
    const ada = await harness.addUser("ada");
    const admin = await harness.addUser("admin", {
      isAdmin: true,
      mode: "admin",
    });

    await harness.addProject("b");
    await harness.addProject("a");
    await harness.service.create(ada, pageInput({ scope: "private" }));
    await harness.service.create(ada, pageInput({ scope: "private" }));

    expect(
      await harness.repository.lookups.findProjectNames(["b", "a", "none"]),
    ).toEqual([
      { id: "a", name: "Project a" },
      { id: "b", name: "Project b" },
    ]);
    expect(await harness.repository.lookups.findProjectNames([])).toEqual([]);
    expect(await harness.service.countPrivatePages(admin)).toEqual(
      new Map([["ada", 2]]),
    );
    expect(await harness.service.countPrivatePages(ada)).toEqual(new Map());
  });

  it("names the author of a version even when the account vanished", async () => {
    const harness = createWikiHarness(getDatabase());
    const ada = await harness.addUser("ada");
    const page = await harness.service.create(ada, pageInput());

    await getDatabase().execute(
      "UPDATE wiki_page_versions SET author_id = 'ghost';",
    );

    const [version] = await harness.service.listVersions(ada, page.id);
    const detail = await harness.service.getVersion(
      ada,
      page.id,
      version?.id ?? "",
    );

    expect(version?.authorName).toBe("");
    expect(detail.authorName).toBe("");
  });

  it("names owners and editors that vanished as empty text", async () => {
    const harness = createWikiHarness(getDatabase());
    const ada = await harness.addUser("ada");
    const page = await harness.service.create(ada, pageInput());

    await getDatabase().execute(
      "UPDATE wiki_pages SET owner_id = 'ghost', updated_by = NULL;",
    );
    await getDatabase().execute(
      "UPDATE wiki_page_versions SET author_id = 'ghost';",
    );

    const view = await harness.service.read(
      await harness.addUser("bob"),
      page.id,
    );

    expect(view.kind === "page" && view.view.page).toMatchObject({
      ownerName: "",
      updatedByName: null,
    });

    const admin = await harness.addUser("root", {
      isAdmin: true,
      mode: "admin",
    });

    await harness.service.delete(admin, page.id);

    expect((await harness.service.listTrash(admin))[0]).toMatchObject({
      ownerName: "",
    });
  });
});

describe("wiki permissions", () => {
  const viewer = (overrides: Partial<WikiViewer> = {}): WikiViewer => ({
    canManageProjects: false,
    canWrite: true,
    scope: SCOPE,
    user: {
      displayName: "U",
      id: "u",
      isActive: true,
      mustChangePassword: false,
      role: "employee",
      username: "u",
    },
    ...overrides,
  });

  it("never lets anybody but the owner manage a private page", () => {
    const stranger = viewer({
      canManageProjects: true,
      scope: { ...SCOPE, isAdmin: true, userId: "other" },
    });

    expect(canManagePage(stranger, { ownerId: "u", scope: "private" })).toBe(
      false,
    );
    expect(canManagePage(viewer(), { ownerId: "u", scope: "private" })).toBe(
      true,
    );
    expect(canManagePage(stranger, { ownerId: "u", scope: "instance" })).toBe(
      true,
    );
    expect(canManagePage(stranger, { ownerId: "u", scope: "project" })).toBe(
      true,
    );
    expect(
      canManagePage(
        viewer({ canManageProjects: true, scope: { ...SCOPE, userId: "o" } }),
        { ownerId: "u", scope: "instance" },
      ),
    ).toBe(false);
  });

  it("resolves the scope of an account with and without project data", async () => {
    const projectService = {
      workItemVisibility: async () => ({ departmentIds: null }),
    };
    const permissionService = {
      hasCapability: async (_user: unknown, capability: string) =>
        capability === CAPABILITY.WRITE,
    };
    const resolved = await new WikiAccess(
      projectService as never,
      permissionService as never,
    ).resolve(viewer().user);

    expect(resolved).toMatchObject({
      canManageProjects: false,
      canWrite: true,
      scope: { departmentIds: [], isAdmin: true, projectIds: [] },
    });
  });
});

describe("wiki anchor validation", () => {
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

    const scope: WikiVisibilityScope = {
      departmentIds: ["sales"],
      isAdmin: false,
      projectIds: ["p1"],
      userId: "u",
    };
    const check = (
      anchors: {
        kind: "department" | "milestone" | "epic";
        targetId: string;
      }[],
      placement: {
        scope: "instance" | "project" | "private";
        projectId: string | null;
      } = {
        projectId: null,
        scope: "instance",
      },
      viewerScope: WikiVisibilityScope = scope,
    ) => validateAnchors(harness.repository, viewerScope, placement, anchors);

    return { check, scope };
  }

  it("accepts readable targets and removes duplicates", async () => {
    const { check } = await setup();

    const anchors = await check([
      { kind: "department", targetId: "sales" },
      { kind: "department", targetId: "sales" },
      { kind: "milestone", targetId: "m1" },
      { kind: "epic", targetId: "e1" },
    ]);

    expect(anchors).toHaveLength(3);
  });

  it("rejects unknown targets and targets the viewer cannot read", async () => {
    const { check } = await setup();
    const invalid = (
      anchors: Parameters<typeof check>[0],
      ...rest: unknown[]
    ) =>
      expect(check(anchors, ...(rest as []))).rejects.toBeInstanceOf(
        WikiValidationError,
      );

    await invalid([{ kind: "department", targetId: "missing" }]);
    await invalid([{ kind: "department", targetId: "dev" }]);
    await invalid([{ kind: "milestone", targetId: "m2" }]);
    await invalid([{ kind: "epic", targetId: "e-dev" }]);
    await invalid([{ kind: "epic", targetId: "missing" }]);
  });

  it("lets administrators tie pages to any department and epic of a readable project", async () => {
    const { check, scope } = await setup();

    await expect(
      check(
        [
          { kind: "department", targetId: "dev" },
          { kind: "epic", targetId: "e-dev" },
        ],
        { projectId: null, scope: "instance" },
        { ...scope, isAdmin: true },
      ),
    ).resolves.toHaveLength(2);
  });

  it("keeps project pages to targets of their project and private pages anchor-free", async () => {
    const { check } = await setup();

    await expect(
      check([{ kind: "milestone", targetId: "m1" }], {
        projectId: "p1",
        scope: "project",
      }),
    ).resolves.toHaveLength(1);
    await expect(
      check([{ kind: "milestone", targetId: "m1" }], {
        projectId: "p2",
        scope: "project",
      }),
    ).rejects.toBeInstanceOf(WikiValidationError);
    await expect(
      check([{ kind: "department", targetId: "sales" }], {
        projectId: null,
        scope: "private",
      }),
    ).rejects.toBeInstanceOf(WikiValidationError);
    await expect(
      check([], { projectId: null, scope: "private" }),
    ).resolves.toEqual([]);
  });

  it("changes the anchors of a managed page", async () => {
    const harness = createWikiHarness(getDatabase());

    await harness.addDepartment("sales");

    const ada = await harness.addUser("ada", { departments: ["sales"] });
    const bob = await harness.addUser("bob");
    const page = await harness.service.create(ada, pageInput());

    await harness.service.setAnchors(ada, page.id, [
      { kind: "department", targetId: "sales" },
    ]);

    const read = await harness.service.read(ada, page.id);

    expect(read.kind === "page" && read.view.page.anchors).toEqual([
      { kind: "department", label: "Department sales", targetId: "sales" },
    ]);
    await expect(
      harness.service.setAnchors(bob, page.id, []),
    ).rejects.toThrow();
    await expect(
      harness.service.setAnchors(ada, page.id, [
        { kind: "department", targetId: "missing" },
      ]),
    ).rejects.toBeInstanceOf(WikiValidationError);
  });
});
