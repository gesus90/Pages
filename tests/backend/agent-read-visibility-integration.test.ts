import { describe, expect, it } from "vitest";

import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { createAccess, createRole } from "../helpers/authorization";
import { createWikiHarness, pageInput } from "../helpers/wiki-harness";
import { useMigratedDatabase } from "../helpers/test-database";

const identity = { userId: "reader", isAdmin: false, permissions: [] };

describe("agent reads with real visibility and foreign records", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const database = getDatabase();
    const harness = createWikiHarness(database);
    const owner = await harness.addUser("owner", {
      isAdmin: true,
      mode: "admin",
    });
    const reader = await harness.addUser("reader", {
      departments: ["alpha"],
      capabilities: [],
    });
    await harness.addDepartment("alpha");
    await harness.addDepartment("beta");
    await harness.addProject("alpha", ["alpha"]);
    await harness.addProject("beta", ["beta"]);
    const visible = await harness.service.create(
      owner,
      pageInput({
        title: "Visible needle",
        content: "# Markdown needle",
        scope: "project",
        projectId: "alpha",
      }),
    );
    const foreign = await harness.service.create(
      owner,
      pageInput({
        title: "Foreign needle",
        content: "foreign secret needle",
        scope: "project",
        projectId: "beta",
      }),
    );
    const department = await harness.service.create(
      owner,
      pageInput({
        title: "Department needle",
        content: "department secret needle",
        anchors: [{ kind: "department", targetId: "beta" }],
      }),
    );
    const privatePage = await harness.service.create(
      owner,
      pageInput({
        title: "Private needle",
        content: "private secret needle",
        scope: "private",
      }),
    );
    await harness.service.create(
      owner,
      pageInput({ title: "Hidden descendant needle", parentId: department.id }),
    );
    const users = new UserRepository(database);
    const router = new AgentOperationRouter({
      projects: new ProjectRepository(database),
      wiki: harness.repository,
      users: { getById: (id) => users.findById(id) },
    });
    return {
      ...harness,
      owner,
      reader,
      visible,
      foreign,
      department,
      privatePage,
      router,
    };
  }

  it("resolves exact trimmed names, returns an allowlist and hides missing and foreign projects alike", async () => {
    const { router } = await setup();
    expect(
      await router.handle(identity, {
        operation: "projects.resolve",
        parameters: { name: "  Project alpha  " },
      }),
    ).toEqual({
      apiVersion: "1",
      result: { id: "alpha", name: "Project alpha" },
    });
    expect(
      await router.handle(identity, {
        operation: "projects.read",
        parameters: { projectId: "alpha" },
      }),
    ).toMatchObject({
      result: {
        id: "alpha",
        name: "Project alpha",
        description: "",
        status: "planned",
      },
    });
    for (const projectId of ["beta", "missing"])
      await expect(
        router.handle(identity, {
          operation: "projects.read",
          parameters: { projectId },
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(
      router.handle(identity, {
        operation: "projects.resolve",
        parameters: { name: "project alpha" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns only visible candidates on ambiguity and never selects a target", async () => {
    const { router, addProject, database } = await setup();
    await addProject("duplicate", ["alpha"]);
    await database.execute(
      "UPDATE projects SET name = 'Project alpha' WHERE id IN ('duplicate', 'beta');",
    );
    await expect(
      router.handle(identity, {
        operation: "projects.resolve",
        parameters: { name: "Project alpha" },
      }),
    ).rejects.toMatchObject({
      code: "AMBIGUOUS",
      status: 409,
      details: {
        candidates: [
          { id: "alpha", name: "Project alpha" },
          { id: "duplicate", name: "Project alpha" },
        ],
        truncated: false,
      },
    });
  });

  it("reads Markdown and revision without changing visits or exposing personal UI state", async () => {
    const { router, visible, database } = await setup();
    const before = await database.query(
      "SELECT user_id, page_id, visited_at FROM wiki_recent_pages;",
    );
    const response = await router.handle(identity, {
      operation: "wiki.page.read",
      parameters: { pageId: visible.id },
    });
    expect(response).toEqual({
      apiVersion: "1",
      result: {
        id: visible.id,
        title: visible.title,
        content: "# Markdown needle",
        revision: 1,
        parentId: null,
        scope: "project",
        projectId: "alpha",
      },
    });
    expect(
      await database.query(
        "SELECT user_id, page_id, visited_at FROM wiki_recent_pages;",
      ),
    ).toEqual(before);
  });

  it("filters nodes, snippets and totals before projecting; hidden subtrees and private pages remain absent", async () => {
    const { router, visible, foreign, department, privatePage } = await setup();
    const tree = await router.handle(identity, {
      operation: "wiki.tree.read",
      parameters: {},
    });
    expect(tree).toMatchObject({
      result: { nodes: [{ id: visible.id }], total: 1, truncated: false },
    });
    const search = await router.handle(identity, {
      operation: "wiki.search",
      parameters: { text: "needle" },
    });
    expect(search).toMatchObject({
      result: {
        results: [
          { id: visible.id, snippet: expect.stringContaining("needle") },
        ],
        total: 1,
        truncated: false,
      },
    });
    for (const pageId of [foreign.id, department.id, privatePage.id, "missing"])
      await expect(
        router.handle(identity, {
          operation: "wiki.page.read",
          parameters: { pageId },
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    for (const operation of ["wiki.tree.read", "wiki.search"])
      await expect(
        router.handle(identity, {
          operation,
          parameters: {
            projectId: "beta",
            ...(operation === "wiki.search" ? { text: "needle" } : {}),
          },
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("grants personal admins equal MCP scope in both modes, leaves persisted mode alone and hides private content", async () => {
    const { router, owner, service, privatePage, database } = await setup();
    const authorization = new AuthorizationRepository(database);
    const account = createAccess({
      userId: "reader",
      isAdmin: true,
      mode: "role",
      departments: ["alpha"],
      role: createRole({ id: "role-reader", permissions: [] }),
    });
    await authorization.saveAccount(account);
    const asAdmin = { ...identity, isAdmin: true };
    const roleTree = await router.handle(asAdmin, {
      operation: "wiki.tree.read",
      parameters: {},
    });
    expect(roleTree).toMatchObject({ result: { total: 4 } });
    expect(
      (await authorization.snapshot()).accounts.find(
        (entry) => entry.userId === "reader",
      )?.mode,
    ).toBe("role");
    expect(
      await router.handle(asAdmin, {
        operation: "wiki.search",
        parameters: { text: "needle" },
      }),
    ).toMatchObject({ result: { total: 4 } });
    await authorization.saveAccount({ ...account, mode: "admin" });
    expect(
      await router.handle(asAdmin, {
        operation: "wiki.tree.read",
        parameters: {},
      }),
    ).toEqual(roleTree);
    expect(
      (await authorization.snapshot()).accounts.find(
        (entry) => entry.userId === "reader",
      )?.mode,
    ).toBe("admin");
    await expect(
      router.handle(asAdmin, {
        operation: "wiki.page.read",
        parameters: { pageId: privatePage.id },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const placeholder = await service.read(
      { ...owner, id: "reader" },
      privatePage.id,
    );
    expect(placeholder).toMatchObject({ kind: "placeholder" });
    expect(JSON.stringify(placeholder)).not.toMatch(
      /Private needle|private secret/,
    );
  });

  it("rejects unknown operations, untrusted parameters and missing or password-gated actors", async () => {
    const { router, database } = await setup();
    for (const input of [
      { operation: "unknown" },
      { operation: "wiki.tree.read", parameters: null },
      { operation: "wiki.tree.read", parameters: [] },
      { operation: "wiki.tree.read", parameters: "invalid" },
      { operation: "wiki.tree.read", parameters: { isAdmin: true } },
      { operation: "wiki.search", parameters: { text: "" } },
      { operation: "wiki.search", parameters: { text: "   " } },
      { operation: "wiki.search", parameters: { text: 1 } },
      { operation: "wiki.search", parameters: { text: "x".repeat(201) } },
      { operation: "wiki.tree.read", parameters: { projectId: null } },
    ])
      await expect(router.handle(identity, input)).rejects.toMatchObject({
        code: "INVALID_REQUEST",
        status: 400,
      });
    await expect(
      router.handle(
        { ...identity, userId: "missing" },
        { operation: "wiki.tree.read" },
      ),
    ).rejects.toMatchObject({ status: 401 });
    await database.execute(
      "UPDATE users SET must_change_password = 1 WHERE id = 'reader';",
    );
    await expect(
      router.handle(identity, { operation: "wiki.tree.read" }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("bounds the serialized page envelope in UTF-8 bytes and never truncates Markdown", async () => {
    const { router, visible, database } = await setup();
    await database.execute(
      "UPDATE wiki_pages SET content = $content WHERE id = $id;",
      { content: "\u0001".repeat(200000), id: visible.id },
    );
    await expect(
      router.handle(identity, {
        operation: "wiki.page.read",
        parameters: { pageId: visible.id },
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE", status: 413 });
  });

  it("supports explicit visible-project tree and search filters", async () => {
    const { router, visible } = await setup();
    expect(
      await router.handle(identity, {
        operation: "wiki.tree.read",
        parameters: { projectId: "alpha" },
      }),
    ).toMatchObject({ result: { nodes: [{ id: visible.id }], total: 1 } });
    expect(
      await router.handle(identity, {
        operation: "wiki.search",
        parameters: { text: "needle", projectId: "alpha" },
      }),
    ).toMatchObject({ result: { results: [{ id: visible.id }], total: 1 } });
  });

  it("uses fresh project names and departments on the next call and fails closed for inactive users", async () => {
    const { router, database } = await setup();
    await router.handle(identity, {
      operation: "projects.resolve",
      parameters: { name: "Project alpha" },
    });
    await database.execute(
      "UPDATE projects SET name = 'Renamed' WHERE id = 'alpha';",
    );
    expect(
      await router.handle(identity, {
        operation: "projects.resolve",
        parameters: { name: "Renamed" },
      }),
    ).toMatchObject({ result: { id: "alpha" } });
    await database.execute(
      "DELETE FROM department_members WHERE user_id = 'reader';",
    );
    await expect(
      router.handle(identity, {
        operation: "projects.read",
        parameters: { projectId: "alpha" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await database.execute(
      "UPDATE users SET is_active = 0 WHERE id = 'reader';",
    );
    await expect(
      router.handle(identity, { operation: "wiki.tree.read", parameters: {} }),
    ).rejects.toMatchObject({ status: 401 });
  });
});
