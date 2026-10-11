import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { useMigratedDatabase } from "../helpers/test-database";
import { pageInput } from "../helpers/wiki-harness";
import { createWikiImportHarness, importRequest } from "../helpers/wiki-import";

import type { AgentIdentity } from "@/definition/McpAuthorization";

const identity: AgentIdentity = {
  userId: "writer",
  isAdmin: false,
  permissions: ["write"],
};

describe("wiki.import.plan through the operation router", () => {
  const getDatabase = useMigratedDatabase();
  const directories = new Set<string>();
  afterEach(() => {
    for (const directory of directories)
      rmSync(directory, { recursive: true, force: true });
    directories.clear();
  });
  async function setup() {
    const harness = await createWikiImportHarness(getDatabase());
    directories.add(harness.filesDirectory);
    return harness;
  }

  it("dispatches the bounded read-only preview with the authenticated account", async () => {
    const { router } = await setup();
    expect(
      await router.handle(identity, {
        operation: "wiki.import.plan",
        parameters: importRequest(),
        actor: { isAdmin: true },
      }),
    ).toMatchObject({
      apiVersion: "1",
      result: { valid: true, pages: [{ title: "new", action: "create" }] },
    });
    await expect(
      router.handle(identity, {
        operation: "wiki.import.plan",
        parameters: { ...importRequest(), userId: "owner" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("keeps hidden/missing projects and private, anchored, deleted, foreign and mismatched parents indistinguishable", async () => {
    const { router, service, owner, database } = await setup();
    const foreign = await service.create(
      owner,
      pageInput({
        scope: "project",
        projectId: "beta",
        title: "Foreign secret",
      }),
    );
    const privatePage = await service.create(
      owner,
      pageInput({ scope: "private", title: "Private secret" }),
    );
    const instance = await service.create(
      owner,
      pageInput({ title: "Instance secret" }),
    );
    const anchored = await service.create(
      owner,
      pageInput({
        scope: "project",
        projectId: "alpha",
        title: "Anchored secret",
        anchors: [{ kind: "department", targetId: "beta" }],
      }),
    );
    const descendant = await service.create(
      owner,
      pageInput({ parentId: anchored.id, title: "Hidden descendant secret" }),
    );
    const deleted = await service.create(
      owner,
      pageInput({
        scope: "project",
        projectId: "alpha",
        title: "Deleted secret",
      }),
    );
    await database.execute(
      "UPDATE wiki_pages SET deleted_at = '2026-10-10T00:00:00Z', deleted_root_id = id WHERE id = $id;",
      { id: deleted.id },
    );
    const failures: string[] = [];
    for (const parameters of [
      importRequest(undefined, { projectId: "beta" }),
      importRequest(undefined, { projectId: "missing" }),
      ...[
        foreign.id,
        privatePage.id,
        anchored.id,
        descendant.id,
        instance.id,
        deleted.id,
        "missing",
      ].map((parentId) => importRequest(undefined, { parentId })),
    ]) {
      try {
        await router.handle(identity, {
          operation: "wiki.import.plan",
          parameters,
        });
        throw new Error("Expected inaccessible destination");
      } catch (error: unknown) {
        expect(error).toMatchObject({
          code: "NOT_FOUND",
          status: 404,
          details: undefined,
        });
        if (!(error instanceof AgentOperationError))
          throw new Error("Expected operation error");
        failures.push(
          JSON.stringify({
            code: error.code,
            status: error.status,
            message: error.message,
            details: error.details,
          }),
        );
      }
    }
    expect(failures.every((failure) => failure === failures[0])).toBe(true);
    expect(JSON.stringify(failures)).not.toMatch(
      /Foreign|Private|Instance|Anchored|descendant|Deleted|secret/,
    );
  });

  it("does not report hidden sibling names or counts as conflicts", async () => {
    const { router, service, owner } = await setup();
    await service.create(
      owner,
      pageInput({
        scope: "project",
        projectId: "alpha",
        title: "new",
        anchors: [{ kind: "department", targetId: "beta" }],
      }),
    );
    await service.create(
      owner,
      pageInput({ scope: "project", projectId: "beta", title: "new" }),
    );
    expect(
      await router.handle(identity, {
        operation: "wiki.import.plan",
        parameters: importRequest(),
      }),
    ).toMatchObject({ result: { valid: true, errors: [], conflicts: [] } });
  });

  it("uses fresh persisted write and project rights, ignoring stale caller identity and admin claims", async () => {
    const { router, database } = await setup();
    const input = {
      operation: "wiki.import.plan",
      parameters: importRequest(),
    };
    await router.handle(identity, input);
    await database.execute(
      "DELETE FROM role_permissions WHERE role_id = 'role-writer';",
    );
    expect(
      await router.handle({ ...identity, isAdmin: true }, input),
    ).toMatchObject({
      result: {
        valid: false,
        errors: [{ code: "FORBIDDEN", reason: "write_permission_required" }],
        pages: [{ action: "invalid" }],
      },
    });
    await database.execute(
      "DELETE FROM department_members WHERE user_id = 'writer';",
    );
    await expect(router.handle(identity, input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("permits personal admins in role mode while continuing to reject another person's private target", async () => {
    const { router, owner, service, database } = await setup();
    const authorization = new AuthorizationRepository(database);
    const account = (await authorization.snapshot()).accounts.find(
      (entry) => entry.userId === "writer",
    );
    if (!account) throw new Error("Expected account");
    await authorization.saveAccount({
      ...account,
      isAdmin: true,
      mode: "role",
    });
    const foreign = await service.create(
      owner,
      pageInput({
        scope: "project",
        projectId: "beta",
        title: "Visible to admin",
      }),
    );
    expect(
      await router.handle(identity, {
        operation: "wiki.import.plan",
        parameters: importRequest(undefined, {
          projectId: "beta",
          parentId: foreign.id,
        }),
      }),
    ).toMatchObject({ result: { valid: true } });
    const privatePage = await service.create(
      owner,
      pageInput({ scope: "private", title: "Private secret" }),
    );
    await expect(
      router.handle(identity, {
        operation: "wiki.import.plan",
        parameters: importRequest(undefined, { parentId: privatePage.id }),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      (await authorization.snapshot()).accounts.find(
        (entry) => entry.userId === "writer",
      )?.mode,
    ).toBe("role");
  });

  it("rejects missing, inactive and password-gated actors before planning", async () => {
    const { router, database } = await setup();
    const input = {
      operation: "wiki.import.plan",
      parameters: importRequest(),
    };
    await expect(
      router.handle({ ...identity, userId: "missing" }, input),
    ).rejects.toMatchObject({ status: 401 });
    await database.execute(
      "UPDATE users SET is_active = 0 WHERE id = 'writer';",
    );
    await expect(router.handle(identity, input)).rejects.toMatchObject({
      status: 401,
    });
    await database.execute(
      "UPDATE users SET is_active = 1, must_change_password = 1 WHERE id = 'writer';",
    );
    await expect(router.handle(identity, input)).rejects.toMatchObject({
      status: 401,
    });
  });
});
