import { beforeEach, expect, it, vi } from "vitest";

import { handleWikiLayoutAction } from "@/app/lib/wiki-actions/wiki-layout-actions.server";
import { WikiAccessDeniedError } from "@/backend/error/WikiErrors";

import { ACTOR } from "../../actions/action-fixtures";
import {
  runWikiHandler,
  storedPage,
  wikiContext,
} from "./wiki-action-fixtures";

import type { ActionOutcome, FormFields } from "../../actions/action-fixtures";

// The handlers get their services from the context; nothing starts the real ones.
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

const wikiService = {
  create: vi.fn(),
  delete: vi.fn(),
  deletePrivateAsAdministrator: vi.fn(),
  duplicate: vi.fn(),
  markFeedRead: vi.fn(),
  move: vi.fn(),
  previewMove: vi.fn(),
  purge: vi.fn(),
  restore: vi.fn(),
  setExpanded: vi.fn(),
  setFavorite: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
});

async function submit(fields: FormFields): Promise<ActionOutcome> {
  return runWikiHandler(
    handleWikiLayoutAction,
    wikiContext({ wikiService }, fields, null),
  );
}

function nothingCalled(): void {
  for (const method of Object.values(wikiService)) {
    expect(method).not.toHaveBeenCalled();
  }
}

it("creates a page and opens it", async () => {
  wikiService.create.mockResolvedValue(storedPage("new-1", "Über uns"));

  const outcome = await submit({
    intent: "create-page",
    scope: "project",
    projectId: "p1",
    parentId: "parent-1",
    icon: "book",
    templateId: "tpl-1",
    title: "Über uns",
    content: "Hello",
  });

  expect(wikiService.create).toHaveBeenCalledExactlyOnceWith(ACTOR, {
    anchors: [],
    content: "Hello",
    icon: "book",
    isTemplate: false,
    parentId: "parent-1",
    projectId: "p1",
    scope: "project",
    templateId: "tpl-1",
    title: "Über uns",
  });
  expect(outcome).toMatchObject({
    status: 302,
    location: "/wiki/new-1/uber-uns",
  });
});

it("creates an empty page and stays on the parent", async () => {
  const page = storedPage("new-2", "");
  wikiService.create.mockResolvedValue(page);

  const outcome = await submit({ intent: "create-page", stay: "1" });

  expect(wikiService.create).toHaveBeenCalledWith(
    ACTOR,
    expect.objectContaining({
      content: "",
      icon: null,
      parentId: null,
      scope: null,
      title: "",
    }),
  );
  expect(outcome).toMatchObject({ status: 200, body: { ok: true, page } });
});

it("refuses a new page of an unknown scope", async () => {
  const outcome = await submit({ intent: "create-page", scope: "team" });

  expect(outcome.status).toBe(400);
  nothingCalled();
});

it.each([
  ["set-expanded", "expanded", "setExpanded"],
  ["set-favorite", "favorite", "setFavorite"],
] as const)(
  "stores %s for the literal 1 only",
  async (intent, field, method) => {
    await submit({ intent, pageId: "page-1", [field]: "1" });
    const outcome = await submit({ intent, pageId: "page-1", [field]: "true" });

    expect(wikiService[method]).toHaveBeenNthCalledWith(
      1,
      ACTOR,
      "page-1",
      true,
    );
    expect(wikiService[method]).toHaveBeenNthCalledWith(
      2,
      ACTOR,
      "page-1",
      false,
    );
    expect(outcome.body).toEqual({ ok: true });
  },
);

it("moves a page to the position the form names", async () => {
  const outcome = await submit({
    intent: "move-page",
    pageId: "page-1",
    scope: "private",
    parentId: "parent-1",
    beforeId: "sibling-1",
  });

  expect(wikiService.move).toHaveBeenCalledExactlyOnceWith(ACTOR, "page-1", {
    beforeId: "sibling-1",
    parentId: "parent-1",
    projectId: null,
    scope: "private",
  });
  expect(outcome.body).toEqual({ ok: true });
});

it("previews a move and keeps the scope when the form names none", async () => {
  const change = { movedPages: 3 };
  wikiService.previewMove.mockResolvedValue(change);

  const outcome = await submit({
    intent: "preview-move",
    pageId: "page-1",
    projectId: "p2",
  });

  expect(wikiService.previewMove).toHaveBeenCalledWith(ACTOR, "page-1", {
    beforeId: null,
    parentId: null,
    projectId: "p2",
    scope: null,
  });
  expect(outcome.body).toEqual({ ok: true, change });
});

it.each(["move-page", "preview-move"])(
  "refuses %s into an unknown scope",
  async (intent) => {
    const outcome = await submit({ intent, pageId: "page-1", scope: "team" });

    expect(outcome.status).toBe(400);
    nothingCalled();
  },
);

it("deletes a page and returns to the wiki", async () => {
  const outcome = await submit({ intent: "delete-page", pageId: "page-1" });

  expect(wikiService.delete).toHaveBeenCalledWith(ACTOR, "page-1");
  expect(outcome).toMatchObject({ status: 302, location: "/wiki" });
});

it("duplicates a page as a template with its children and opens the copy", async () => {
  wikiService.duplicate.mockResolvedValue(storedPage("copy-1", "Copy"));

  const outcome = await submit({
    intent: "duplicate-page",
    pageId: "page-1",
    title: "Copy",
    template: "1",
    withChildren: "1",
  });

  expect(wikiService.duplicate).toHaveBeenCalledWith(ACTOR, "page-1", {
    isTemplate: true,
    title: "Copy",
    withChildren: true,
  });
  expect(outcome.location).toBe("/wiki/copy-1/copy");
});

it("duplicates a single page without a title", async () => {
  wikiService.duplicate.mockResolvedValue(storedPage("copy-2", ""));

  const outcome = await submit({ intent: "duplicate-page", pageId: "page-1" });

  expect(wikiService.duplicate).toHaveBeenCalledWith(ACTOR, "page-1", {
    isTemplate: false,
    title: "",
    withChildren: false,
  });
  expect(outcome.location).toBe("/wiki/copy-2");
});

it.each([
  ["restore-page", "restore"],
  ["purge-page", "purge"],
] as const)("runs %s on the trashed page", async (intent, method) => {
  const outcome = await submit({ intent, pageId: "page-1" });

  expect(wikiService[method]).toHaveBeenCalledWith(ACTOR, "page-1");
  expect(outcome.body).toEqual({ ok: true });
});

it("deletes a private page as administrator and returns to the wiki", async () => {
  const outcome = await submit({
    intent: "delete-private-page",
    pageId: "page-1",
  });

  expect(wikiService.deletePrivateAsAdministrator).toHaveBeenCalledWith(
    ACTOR,
    "page-1",
  );
  expect(outcome.location).toBe("/wiki");
});

it("deletes a private page as administrator and stays", async () => {
  const outcome = await submit({
    intent: "delete-private-page",
    pageId: "page-1",
    stay: "1",
  });

  expect(outcome).toMatchObject({ status: 200, body: { ok: true } });
});

it("marks the feed as read", async () => {
  const outcome = await submit({ intent: "mark-feed-read" });

  expect(wikiService.markFeedRead).toHaveBeenCalledExactlyOnceWith(ACTOR);
  expect(outcome.body).toEqual({ ok: true });
});

it.each([
  "set-expanded",
  "set-favorite",
  "move-page",
  "preview-move",
  "delete-page",
  "duplicate-page",
  "restore-page",
  "purge-page",
  "delete-private-page",
])("refuses %s without a page", async (intent) => {
  const outcome = await submit({ intent, pageId: "" });

  expect(outcome).toMatchObject({
    status: 400,
    body: { ok: false, error: "invalidInput" },
  });
  nothingCalled();
});

it("answers a refused structure change with 403", async () => {
  wikiService.purge.mockRejectedValue(new WikiAccessDeniedError());

  const outcome = await submit({ intent: "purge-page", pageId: "page-1" });

  expect(outcome).toMatchObject({
    status: 403,
    body: { ok: false, error: "forbidden" },
  });
});
