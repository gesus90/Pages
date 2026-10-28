import { beforeEach, expect, it, vi } from "vitest";

import { handleWikiPageAction } from "@/app/lib/wiki-actions/wiki-page-actions.server";
import { WikiConflictError } from "@/backend/error/WikiErrors";

import { ACTOR } from "../../actions/action-fixtures";
import {
  PAGE_ID,
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
  addComment: vi.fn(),
  editComment: vi.fn(),
  getVersion: vi.fn(),
  removeAttachment: vi.fn(),
  removeComment: vi.fn(),
  resolveComment: vi.fn(),
  restoreVersion: vi.fn(),
  setAnchors: vi.fn(),
  setCover: vi.fn(),
  setCurrentUntil: vi.fn(),
  setOwner: vi.fn(),
  update: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
});

async function submit(
  fields: FormFields,
  pageId: string | null = PAGE_ID,
): Promise<ActionOutcome> {
  return runWikiHandler(
    handleWikiPageAction,
    wikiContext({ wikiService }, fields, pageId),
  );
}

function nothingCalled(): void {
  for (const method of Object.values(wikiService)) {
    expect(method).not.toHaveBeenCalled();
  }
}

it("saves the page against the revision it was opened at", async () => {
  const page = storedPage();
  wikiService.update.mockResolvedValue(page);

  const outcome = await submit({
    intent: "save",
    expectedRevision: "3",
    content: "New text",
    title: "New title",
    icon: "star",
  });

  expect(wikiService.update).toHaveBeenCalledExactlyOnceWith(ACTOR, PAGE_ID, {
    content: "New text",
    expectedRevision: 3,
    icon: "star",
    title: "New title",
  });
  expect(outcome.body).toEqual({ ok: true, page });
});

it("saves an emptied page", async () => {
  wikiService.update.mockResolvedValue(storedPage());

  await submit({ intent: "save", expectedRevision: "0" });

  expect(wikiService.update).toHaveBeenCalledWith(ACTOR, PAGE_ID, {
    content: "",
    expectedRevision: 0,
    icon: null,
    title: "",
  });
});

it("hands the saved page back when somebody else saved first", async () => {
  const current = storedPage();
  wikiService.update.mockRejectedValue(new WikiConflictError(current));

  const outcome = await submit({ intent: "save", expectedRevision: "2" });

  expect(outcome).toMatchObject({
    status: 409,
    body: { ok: false, error: "conflict", current },
  });
});

it("refuses a save with a revision that is no integer", async () => {
  const outcome = await submit({ intent: "save", expectedRevision: "2.5" });

  expect(outcome.status).toBe(400);
  nothingCalled();
});

it("restores and reads a version", async () => {
  const page = storedPage();
  const version = { id: "v1", content: "Old" };
  wikiService.restoreVersion.mockResolvedValue(page);
  wikiService.getVersion.mockResolvedValue(version);

  const restored = await submit({ intent: "restore-version", versionId: "v1" });
  const read = await submit({ intent: "get-version", versionId: "v1" });

  expect(wikiService.restoreVersion).toHaveBeenCalledWith(ACTOR, PAGE_ID, "v1");
  expect(wikiService.getVersion).toHaveBeenCalledWith(ACTOR, PAGE_ID, "v1");
  expect(restored.body).toEqual({ ok: true, page });
  expect(read.body).toEqual({ ok: true, version });
});

it("sets and clears the date until which the page is current", async () => {
  await submit({ intent: "set-current-until", currentUntil: "2026-12-31" });
  const outcome = await submit({ intent: "set-current-until" });

  expect(wikiService.setCurrentUntil).toHaveBeenNthCalledWith(
    1,
    ACTOR,
    PAGE_ID,
    "2026-12-31",
  );
  expect(wikiService.setCurrentUntil).toHaveBeenNthCalledWith(
    2,
    ACTOR,
    PAGE_ID,
    null,
  );
  expect(outcome.body).toEqual({ ok: true });
});

it("sets the cover and returns the stored one", async () => {
  wikiService.setCover.mockResolvedValue("cover-1");

  const outcome = await submit({ intent: "set-cover", cover: "cover-1" });

  expect(wikiService.setCover).toHaveBeenCalledWith(ACTOR, PAGE_ID, "cover-1");
  expect(outcome.body).toEqual({ ok: true, cover: "cover-1" });
});

it("ties the page to the anchors of the form", async () => {
  const outcome = await submit({
    intent: "set-anchors",
    anchor: ["department:d1", "epic:SYN:7"],
  });

  expect(wikiService.setAnchors).toHaveBeenCalledWith(ACTOR, PAGE_ID, [
    { kind: "department", targetId: "d1" },
    { kind: "epic", targetId: "SYN:7" },
  ]);
  expect(outcome.body).toEqual({ ok: true });
});

it("unties the page when the form carries no anchor", async () => {
  await submit({ intent: "set-anchors" });

  expect(wikiService.setAnchors).toHaveBeenCalledWith(ACTOR, PAGE_ID, []);
});

it.each([["project:p1"], ["milestone:"], ["epic"]])(
  "refuses the anchor %s",
  async (anchor) => {
    const outcome = await submit({ intent: "set-anchors", anchor });

    expect(outcome.status).toBe(400);
    nothingCalled();
  },
);

it("hands the page to another owner", async () => {
  const outcome = await submit({ intent: "set-owner", ownerId: "user-2" });

  expect(wikiService.setOwner).toHaveBeenCalledWith(ACTOR, PAGE_ID, "user-2");
  expect(outcome.body).toEqual({ ok: true });
});

it("removes an attachment, also without a page of the route", async () => {
  const outcome = await submit(
    { intent: "delete-attachment", attachmentId: "a1" },
    null,
  );

  expect(wikiService.removeAttachment).toHaveBeenCalledWith(ACTOR, "a1");
  expect(outcome.body).toEqual({ ok: true });
});

it("adds a comment that quotes the page", async () => {
  const comment = { id: "c1" };
  wikiService.addComment.mockResolvedValue(comment);

  const outcome = await submit({
    intent: "add-comment",
    body: "Looks good",
    parentId: "c0",
    quote: "text",
    quotePrefix: "the ",
    quoteSuffix: " here",
  });

  expect(wikiService.addComment).toHaveBeenCalledWith(ACTOR, PAGE_ID, {
    body: "Looks good",
    parentId: "c0",
    quote: "text",
    quotePrefix: "the ",
    quoteSuffix: " here",
  });
  expect(outcome.body).toEqual({ ok: true, comment });
});

it("adds an empty comment and leaves the service to judge it", async () => {
  await submit({ intent: "add-comment" });

  expect(wikiService.addComment).toHaveBeenCalledWith(ACTOR, PAGE_ID, {
    body: "",
    parentId: null,
    quote: null,
    quotePrefix: null,
    quoteSuffix: null,
  });
});

it("edits, resolves and deletes comments", async () => {
  await submit({ intent: "edit-comment", commentId: "c1", body: "Edited" });
  await submit({ intent: "edit-comment", commentId: "c2" });
  await submit({ intent: "resolve-comment", commentId: "c1", resolved: "1" });
  await submit({ intent: "resolve-comment", commentId: "c2" });
  const outcome = await submit({ intent: "delete-comment", commentId: "c1" });

  expect(wikiService.editComment).toHaveBeenNthCalledWith(
    1,
    ACTOR,
    "c1",
    "Edited",
  );
  expect(wikiService.editComment).toHaveBeenNthCalledWith(2, ACTOR, "c2", "");
  expect(wikiService.resolveComment).toHaveBeenNthCalledWith(
    1,
    ACTOR,
    "c1",
    true,
  );
  expect(wikiService.resolveComment).toHaveBeenNthCalledWith(
    2,
    ACTOR,
    "c2",
    false,
  );
  expect(wikiService.removeComment).toHaveBeenCalledWith(ACTOR, "c1");
  expect(outcome.body).toEqual({ ok: true });
});

it.each<FormFields>([
  { intent: "save", expectedRevision: "1" },
  { intent: "restore-version", versionId: "v1" },
  { intent: "get-version", versionId: "v1" },
  { intent: "set-current-until" },
  { intent: "set-cover" },
  { intent: "set-anchors" },
  { intent: "set-owner", ownerId: "user-2" },
  { intent: "add-comment", body: "x" },
])("refuses %j without a page of the route", async (fields) => {
  const outcome = await submit(fields, null);

  expect(outcome).toMatchObject({
    status: 400,
    body: { ok: false, error: "invalidInput" },
  });
  nothingCalled();
});

it.each([
  "restore-version",
  "get-version",
  "set-owner",
  "delete-attachment",
  "edit-comment",
  "delete-comment",
  "resolve-comment",
])("refuses %s without the identifier it needs", async (intent) => {
  const outcome = await submit({ intent });

  expect(outcome.status).toBe(400);
  nothingCalled();
});
