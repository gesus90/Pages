import { Readable } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  readWikiRequest,
  toWikiActionError,
} from "@/app/lib/wiki-actions/wiki-action-support.server";
import { handleWikiLayoutAction } from "@/app/lib/wiki-actions/wiki-layout-actions.server";
import { handleWikiPageAction } from "@/app/lib/wiki-actions/wiki-page-actions.server";
import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import { WikiAccessDeniedError } from "@/backend/error/WikiErrors";

import { useMigratedDatabase } from "../helpers/test-database";
import { createWikiHarness, pageInput } from "../helpers/wiki-harness";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { User } from "@/definition/User";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

function form(fields: Record<string, string | string[]>): FormData {
  const formData = new FormData();

  for (const [name, value] of Object.entries(fields)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      formData.append(name, entry);
    }
  }

  return formData;
}

async function readBody(response: unknown): Promise<unknown> {
  const data = (response as { data?: unknown }).data;

  return data;
}

describe("wiki actions", () => {
  const getDatabase = useMigratedDatabase();

  async function setup() {
    const harness = createWikiHarness(getDatabase());
    const ada = await harness.addUser("ada");
    const reader = await harness.addUser("reader", { capabilities: [] });
    const services = {
      wikiService: harness.service,
    } as unknown as ApplicationServices;
    const layout = (actor: User, fields: Record<string, string | string[]>) =>
      handleWikiLayoutAction({
        actor,
        formData: form(fields),
        pageId: null,
        services,
      });
    const pageAction = (
      actor: User,
      pageId: string | null,
      fields: Record<string, string | string[]>,
    ) =>
      handleWikiPageAction({ actor, formData: form(fields), pageId, services });

    return { ...harness, ada, layout, pageAction, reader };
  }

  it("creates a page and redirects to it", async () => {
    const { ada, layout, service } = await setup();
    const response = await layout(ada, {
      content: "Hello",
      intent: "create-page",
      scope: "instance",
      title: "First page",
    });

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("Location")).toMatch(
      /^\/wiki\/[\w-]+\/first-page$/,
    );
    expect((await service.navigation(ada)).nodes).toHaveLength(1);
  });

  it("rejects unknown intents, bad scopes and missing fields", async () => {
    const { ada, layout } = await setup();

    expect(await readBody(await layout(ada, { intent: "nope" }))).toEqual({
      error: "invalidInput",
      ok: false,
    });
    expect(
      await readBody(
        await layout(ada, { intent: "create-page", scope: "instance" }),
      ),
    ).toEqual({ error: "titleRequired", ok: false });
    expect(
      await readBody(
        await layout(ada, { intent: "duplicate-page", pageId: "x" }),
      ),
    ).toMatchObject({ ok: false });
    expect(await readBody(await layout(ada, {}))).toEqual({
      error: "invalidInput",
      ok: false,
    });
    expect(
      await readBody(
        await layout(ada, {
          intent: "create-page",
          scope: "galaxy",
          title: "x",
        }),
      ),
    ).toEqual({ error: "invalidInput", ok: false });

    for (const intent of [
      "set-expanded",
      "set-favorite",
      "move-page",
      "preview-move",
      "delete-page",
      "duplicate-page",
      "restore-page",
      "purge-page",
      "delete-private-page",
    ]) {
      expect(await readBody(await layout(ada, { intent }))).toEqual({
        error: "invalidInput",
        ok: false,
      });
    }

    for (const intent of ["move-page", "preview-move"]) {
      expect(
        await readBody(
          await layout(ada, { intent, pageId: "x", scope: "galaxy" }),
        ),
      ).toEqual({ error: "invalidInput", ok: false });
    }
  });

  it("maps failures to responses", async () => {
    const { ada, layout, reader } = await setup();

    expect(
      await readBody(
        await layout(ada, {
          intent: "create-page",
          scope: "instance",
          title: " ",
        }),
      ),
    ).toEqual({ error: "titleRequired", ok: false });
    expect(
      await readBody(
        await layout(ada, { intent: "set-favorite", pageId: "ghost" }),
      ),
    ).toEqual({ error: "notFound", ok: false });
    expect(
      await readBody(
        await layout(reader, {
          intent: "create-page",
          scope: "instance",
          title: "t",
        }),
      ),
    ).toEqual({ error: "forbidden", ok: false });
    expect(toWikiActionError(new ProjectAccessDeniedError())).toMatchObject({
      data: { error: "forbidden" },
    });
    expect(toWikiActionError(new WikiAccessDeniedError())).toMatchObject({
      init: { status: 403 },
    });
    expect(() => toWikiActionError(new Error("boom"))).toThrow("boom");
  });

  it("toggles favorites and open branches, moves and previews", async () => {
    const { ada, layout, service } = await setup();
    const parent = await service.create(ada, pageInput({ title: "Parent" }));
    const child = await service.create(ada, pageInput({ title: "Child" }));
    const ok = { ok: true };

    expect(
      await readBody(
        await layout(ada, {
          favorite: "1",
          intent: "set-favorite",
          pageId: parent.id,
        }),
      ),
    ).toEqual(ok);
    expect(
      await readBody(
        await layout(ada, {
          expanded: "1",
          intent: "set-expanded",
          pageId: parent.id,
        }),
      ),
    ).toEqual(ok);
    expect(
      await readBody(
        await layout(ada, {
          beforeId: "",
          intent: "preview-move",
          pageId: child.id,
          parentId: parent.id,
          projectId: "",
          scope: "instance",
        }),
      ),
    ).toEqual({ change: "same", ok: true });
    expect(
      await readBody(
        await layout(ada, {
          intent: "move-page",
          pageId: child.id,
          parentId: parent.id,
          scope: "instance",
        }),
      ),
    ).toEqual(ok);
    expect(
      (await service.navigation(ada)).nodes.find((n) => n.id === child.id)
        ?.parentId,
    ).toBe(parent.id);
  });

  it("duplicates, deletes, restores and purges", async () => {
    const { ada, layout, service } = await setup();
    const page = await service.create(ada, pageInput({ title: "Doc" }));
    const copy = await layout(ada, {
      intent: "duplicate-page",
      pageId: page.id,
      template: "0",
      title: "Doc copy",
      withChildren: "1",
    });

    expect((copy as Response).headers.get("Location")).toContain("/doc-copy");

    const removed = await layout(ada, {
      intent: "delete-page",
      pageId: page.id,
    });

    expect((removed as Response).headers.get("Location")).toBe("/wiki");
    expect(
      await readBody(
        await layout(ada, { intent: "restore-page", pageId: page.id }),
      ),
    ).toEqual({ ok: true });
    await layout(ada, { intent: "delete-page", pageId: page.id });
    expect(
      await readBody(
        await layout(ada, { intent: "purge-page", pageId: page.id }),
      ),
    ).toEqual({ ok: true });
  });

  it("lets an administrator delete a private page of somebody else", async () => {
    const { ada, layout, service, addUser } = await setup();
    const admin = await addUser("admin", { isAdmin: true, mode: "admin" });
    const secret = await service.create(ada, pageInput({ scope: "private" }));
    const response = await layout(admin, {
      intent: "delete-private-page",
      pageId: secret.id,
    });

    expect((response as Response).headers.get("Location")).toBe("/wiki");
  });

  it("stays on the page when the user management deletes a private page", async () => {
    const { ada, layout, service, addUser } = await setup();
    const admin = await addUser("admin", { isAdmin: true, mode: "admin" });
    const secret = await service.create(ada, pageInput({ scope: "private" }));

    expect(
      await readBody(
        await layout(admin, {
          intent: "delete-private-page",
          pageId: secret.id,
          stay: "1",
        }),
      ),
    ).toEqual({ ok: true });
    expect(await service.findPlaceholder(admin, secret.id)).toBeNull();
  });

  it("saves, reports conflicts and manages versions", async () => {
    const { ada, pageAction, service } = await setup();
    const page = await service.create(ada, pageInput({ content: "one" }));
    const save = (revision: string, content: string) =>
      pageAction(ada, page.id, {
        content,
        expectedRevision: revision,
        icon: "",
        intent: "save",
        title: "Page",
      });

    const saved = (await readBody(await save("1", "two"))) as {
      ok: boolean;
      page: { revision: number };
    };

    expect(saved.ok).toBe(true);
    expect(saved.page.revision).toBe(2);

    const conflict = (await readBody(await save("1", "three"))) as {
      error: string;
      current: { content: string };
    };

    expect(conflict.error).toBe("conflict");
    expect(conflict.current.content).toBe("two");
    expect(
      await readBody(
        await pageAction(ada, page.id, {
          expectedRevision: "2",
          intent: "save",
        }),
      ),
    ).toMatchObject({ error: "titleRequired" });
    expect(await readBody(await save("abc", "x"))).toEqual({
      error: "invalidInput",
      ok: false,
    });
    expect(
      await readBody(
        await pageAction(ada, null, { intent: "save", expectedRevision: "1" }),
      ),
    ).toEqual({
      error: "invalidInput",
      ok: false,
    });

    const [latest] = await service.listVersions(ada, page.id);
    const shown = (await readBody(
      await pageAction(ada, page.id, {
        intent: "get-version",
        versionId: latest?.id ?? "",
      }),
    )) as { version: { content: string } };

    expect(shown.version.content).toBe("two");
    expect(
      await readBody(
        await pageAction(ada, page.id, {
          intent: "restore-version",
          versionId: latest?.id ?? "",
        }),
      ),
    ).toMatchObject({ ok: true });
  });

  it("rejects page actions without a page or required fields", async () => {
    const { ada, pageAction } = await setup();
    const bad = { error: "invalidInput", ok: false };

    for (const intent of ["restore-version", "get-version", "set-owner"]) {
      expect(await readBody(await pageAction(ada, "x", { intent }))).toEqual(
        bad,
      );
      expect(
        await readBody(
          await pageAction(ada, null, { intent, versionId: "v", ownerId: "o" }),
        ),
      ).toEqual(bad);
    }

    for (const intent of ["set-current-until", "set-anchors"]) {
      expect(await readBody(await pageAction(ada, null, { intent }))).toEqual(
        bad,
      );
    }

    expect(
      await readBody(
        await pageAction(ada, "x", {
          anchor: "department",
          intent: "set-anchors",
        }),
      ),
    ).toEqual(bad);
    expect(
      await readBody(
        await pageAction(ada, "x", {
          anchor: "galaxy:1",
          intent: "set-anchors",
        }),
      ),
    ).toEqual(bad);
  });

  it("sets the review date, anchors and owner", async () => {
    const { pageAction, service, addDepartment, addUser } = await setup();

    await addDepartment("d1");

    const ada = await addUser("member", { departments: ["d1"] });
    const bob = await addUser("bob");
    const page = await service.create(ada, pageInput());

    expect(
      await readBody(
        await pageAction(ada, page.id, {
          currentUntil: "2027-05-01",
          intent: "set-current-until",
        }),
      ),
    ).toEqual({ ok: true });
    expect(
      await readBody(
        await pageAction(ada, page.id, {
          anchor: "department:d1",
          intent: "set-anchors",
        }),
      ),
    ).toEqual({ ok: true });
    expect(
      await readBody(
        await pageAction(ada, page.id, {
          anchor: "department:",
          intent: "set-anchors",
        }),
      ),
    ).toEqual({ error: "invalidInput", ok: false });
    expect(
      await readBody(await pageAction(ada, page.id, { intent: "set-anchors" })),
    ).toEqual({ ok: true });
    expect(
      await readBody(
        await pageAction(ada, page.id, {
          intent: "set-owner",
          ownerId: bob.id,
        }),
      ),
    ).toEqual({ ok: true });
  });
});

describe("wiki comment actions", () => {
  const getDatabase = useMigratedDatabase();

  it("adds, edits, resolves and deletes comments and marks the feed read", async () => {
    const harness = createWikiHarness(getDatabase());
    const ada = await harness.addUser("ada");
    const services = {
      wikiService: harness.service,
    } as unknown as ApplicationServices;
    const page = await harness.service.create(ada, pageInput());
    const page$ = (
      fields: Record<string, string>,
      pageId: string | null = page.id,
    ) =>
      handleWikiPageAction({
        actor: ada,
        formData: form(fields),
        pageId,
        services,
      });
    const added = (await readBody(
      await page$({
        body: "Hello",
        intent: "add-comment",
        parentId: "",
        quote: "",
      }),
    )) as { ok: boolean; comment: { id: string } };

    expect(added.ok).toBe(true);
    expect(
      await readBody(await page$({ intent: "add-comment" }, null)),
    ).toEqual({ error: "invalidInput", ok: false });
    expect(await readBody(await page$({ intent: "add-comment" }))).toEqual({
      error: "commentRequired",
      ok: false,
    });

    const id = added.comment.id;

    expect(
      await readBody(
        await page$({ body: "Changed", commentId: id, intent: "edit-comment" }),
      ),
    ).toEqual({ ok: true });
    expect(
      await readBody(
        await page$({
          commentId: id,
          intent: "resolve-comment",
          resolved: "1",
        }),
      ),
    ).toEqual({ ok: true });
    expect(
      await readBody(await page$({ commentId: id, intent: "resolve-comment" })),
    ).toEqual({ ok: true });
    expect(
      await readBody(await page$({ commentId: id, intent: "delete-comment" })),
    ).toEqual({ ok: true });

    expect(
      await readBody(
        await page$({ body: "x", commentId: "none", intent: "edit-comment" }),
      ),
    ).toEqual({ error: "notFound", ok: false });
    expect(
      await readBody(
        await page$({ commentId: "none", intent: "edit-comment" }),
      ),
    ).toEqual({ error: "commentRequired", ok: false });

    const attachment = await harness.service.uploadAttachment(ada, page.id, {
      body: Readable.from([Buffer.from("x")]),
      contentLength: null,
      fileName: "a.txt",
    });

    expect(
      await readBody(
        await page$({
          attachmentId: attachment.id,
          intent: "delete-attachment",
        }),
      ),
    ).toEqual({ ok: true });
    expect(
      await readBody(await page$({ intent: "delete-attachment" })),
    ).toEqual({
      error: "invalidInput",
      ok: false,
    });
    expect(
      await readBody(
        await page$({ attachmentId: "none", intent: "delete-attachment" }),
      ),
    ).toEqual({ error: "notFound", ok: false });

    for (const intent of [
      "edit-comment",
      "delete-comment",
      "resolve-comment",
    ]) {
      expect(await readBody(await page$({ intent }))).toEqual({
        error: "invalidInput",
        ok: false,
      });
    }

    const feed = await handleWikiLayoutAction({
      actor: ada,
      formData: form({ intent: "mark-feed-read" }),
      pageId: null,
      services,
    });

    expect(await readBody(feed)).toEqual({ ok: true });
  });
});

describe("readWikiRequest", () => {
  beforeEach(() => {
    vi.mocked(getApplicationServices).mockResolvedValue(
      {} as ApplicationServices,
    );
  });

  const user = {
    displayName: "U",
    id: "u",
    isActive: true,
    mustChangePassword: false,
    role: "employee",
    username: "u",
  } as const;

  function args(method: string, actor: User | null = user) {
    return {
      context: {
        get: (key: unknown) =>
          key === authenticatedUserContext ? actor : null,
      },
      request: new Request("http://localhost/wiki", {
        body:
          method === "POST" ? new URLSearchParams({ intent: "x" }) : undefined,
        method,
      }),
    } as never;
  }

  it("collects what a handler needs", async () => {
    const context = await readWikiRequest(args("POST"), "page-1");

    expect(context.actor.id).toBe("u");
    expect(context.pageId).toBe("page-1");
    expect(context.formData.get("intent")).toBe("x");
  });

  it("refuses other methods and missing users", async () => {
    await expect(readWikiRequest(args("GET"), null)).rejects.toMatchObject({
      status: 405,
    });
    await expect(
      readWikiRequest(args("POST", null), null),
    ).rejects.toMatchObject({ status: 403 });
  });
});
