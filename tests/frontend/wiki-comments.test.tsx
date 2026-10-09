// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { WikiCommentsPanel } from "@/app/components/wiki/wiki-comments-panel";
import { WikiFeedView } from "@/app/components/wiki/wiki-feed-view";
import { WikiPageScreen } from "@/app/components/wiki/wiki-page-screen";

import { installEditorGeometry } from "../helpers/editor";
import { renderInWiki } from "../helpers/wiki-render";

import type { Editor } from "@tiptap/core";

import type {
  WikiComment,
  WikiCommentThread,
  WikiFeedItem,
  WikiPage,
} from "@/definition/Wiki";

function comment(
  id: string,
  overrides: Partial<WikiComment> = {},
): WikiComment {
  return {
    authorId: "u1",
    authorName: "Olga",
    body: `Body of ${id}`,
    canChange: true,
    canEdit: true,
    createdAt: "2026-01-02 10:00:00",
    id,
    isStale: false,
    pageId: "p1",
    quote: null,
    quotePrefix: null,
    quoteSuffix: null,
    resolvedAt: null,
    resolvedByName: null,
    updatedAt: "2026-01-02 10:00:00",
    ...overrides,
  };
}

function thread(
  id: string,
  overrides: Partial<WikiComment> = {},
  replies: WikiComment[] = [],
): WikiCommentThread {
  return { comment: comment(id, overrides), replies };
}

function renderPanel(
  threads: readonly WikiCommentThread[],
  selection: Parameters<typeof WikiCommentsPanel>[0]["selection"] = null,
  options: Parameters<typeof renderInWiki>[1] = {},
) {
  return renderInWiki(
    <WikiCommentsPanel pageId="p1" selection={selection} threads={threads} />,
    { path: "/wiki/p1", ...options },
  );
}

describe("WikiCommentsPanel", () => {
  it("lists open threads with replies and keeps resolved ones back", async () => {
    renderPanel([
      thread("c1", {}, [
        comment("r1", { authorName: "Max", canChange: false, canEdit: false }),
      ]),
      thread("c2", {
        resolvedAt: "2026-01-03 10:00:00",
        resolvedByName: "Max",
      }),
    ]);

    expect(await screen.findByText("Body of c1")).toBeVisible();
    expect(screen.getByText("Body of r1")).toBeVisible();
    expect(screen.queryByText("Body of c2")).toBeNull();
    expect(screen.getByRole("heading", { name: "Comments (1)" })).toBeVisible();

    await userEvent.click(
      screen.getByRole("button", { name: "Show resolved (1)" }),
    );

    expect(screen.getByText("Body of c2")).toBeVisible();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeVisible();

    await userEvent.click(
      screen.getByRole("button", { name: "Hide resolved" }),
    );

    expect(screen.queryByText("Body of c2")).toBeNull();
  });

  it("explains that nothing is open", async () => {
    renderPanel([]);

    expect(await screen.findByText("No open comments.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Show resolved/ })).toBeNull();
  });

  it("sends a new comment and clears the box", async () => {
    const { pageSubmissions } = renderPanel([]);
    const box = await screen.findByLabelText(/Write a comment/);

    await userEvent.type(box, "Hello @max");
    await userEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() =>
      expect(pageSubmissions[0]).toEqual({
        body: "Hello @max",
        intent: "add-comment",
        parentId: "",
        quote: "",
        quotePrefix: "",
        quoteSuffix: "",
      }),
    );
    await waitFor(() => expect(box).toHaveValue(""));
  });

  it("keeps the submit button off for an empty text and shows the counter near the limit", async () => {
    renderPanel([]);

    const box = await screen.findByLabelText(/Write a comment/);

    expect(screen.getByRole("button", { name: "Comment" })).toBeDisabled();

    fireEvent.change(box, { target: { value: "x".repeat(4100) } });

    expect(screen.getByText("4100 / 5000")).toBeVisible();
  });

  it("shows why a comment was refused", async () => {
    renderPanel([], null, {
      pageAnswers: { "add-comment": { error: "commentTooLong", ok: false } },
    });

    await userEvent.type(await screen.findByLabelText(/Write a comment/), "x");
    await userEvent.click(screen.getByRole("button", { name: "Comment" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A comment must not exceed 5,000 characters.",
    );
  });

  it("comments on a selected passage", async () => {
    const { pageSubmissions } = renderPanel([], {
      prefix: "before",
      quote: "chosen words",
      suffix: "after",
    });

    await userEvent.click(
      await screen.findByRole("button", { name: "Comment on selection" }),
    );

    expect(screen.getByText("chosen words")).toBeVisible();

    await userEvent.type(
      screen.getByLabelText(/Write a comment/),
      "About this",
    );
    await userEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() =>
      expect(pageSubmissions[0]).toMatchObject({
        quote: "chosen words",
        quotePrefix: "before",
        quoteSuffix: "after",
      }),
    );
    await waitFor(() => expect(screen.queryByText("chosen words")).toBeNull());
  });

  it("drops the quote when the person cancels", async () => {
    renderPanel([], { prefix: null, quote: "chosen", suffix: null });

    await userEvent.click(
      await screen.findByRole("button", { name: "Comment on selection" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("chosen")).toBeNull();
  });
});

describe("comment threads", () => {
  it("shows the quoted passage and marks it when the passage changed", async () => {
    renderPanel([
      thread("c1", { isStale: false, quote: "kept passage" }),
      thread("c2", { isStale: true, quote: "old passage" }),
    ]);

    expect(await screen.findByText("kept passage")).toBeVisible();
    expect(screen.getAllByText("Passage changed")).toHaveLength(1);
  });

  it("replies and cancels a reply", async () => {
    const { pageSubmissions } = renderPanel([thread("c1")]);

    await userEvent.click(await screen.findByRole("button", { name: "Reply" }));
    await userEvent.click(
      within(screen.getByRole("list")).getByRole("button", { name: "Cancel" }),
    );

    expect(screen.queryByLabelText("Write a reply")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Reply" }));
    await userEvent.type(screen.getByLabelText("Write a reply"), "Answer");
    await userEvent.click(
      screen.getAllByRole("button", { name: "Reply" }).at(-1) as HTMLElement,
    );

    await waitFor(() =>
      expect(pageSubmissions[0]).toMatchObject({
        body: "Answer",
        intent: "add-comment",
        parentId: "c1",
      }),
    );
  });

  it("resolves and reopens", async () => {
    const { pageSubmissions } = renderPanel([
      thread("c1"),
      thread("c2", { resolvedAt: "2026-01-03 10:00:00" }),
    ]);

    await userEvent.click(
      await screen.findByRole("button", { name: "Resolve" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Show resolved (1)" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Reopen" }));

    await waitFor(() => expect(pageSubmissions).toHaveLength(2));
    expect(pageSubmissions).toEqual([
      { commentId: "c1", intent: "resolve-comment", resolved: "1" },
      { commentId: "c2", intent: "resolve-comment", resolved: "0" },
    ]);
  });

  it("edits the text of an own comment", async () => {
    const { pageSubmissions } = renderPanel([
      thread("c1", { updatedAt: "2026-01-02 11:00:00" }),
    ]);

    expect(await screen.findByText(/edited/)).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Edit comment" }));
    await userEvent.clear(screen.getByLabelText("Comment text"));
    await userEvent.click(
      within(
        screen.getByLabelText("Comment text").closest("form") as HTMLElement,
      ).getByRole("button", { name: "Cancel" }),
    );

    expect(screen.queryByLabelText("Comment text")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Edit comment" }));

    const text = screen.getByLabelText("Comment text");

    await userEvent.clear(text);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(text, "New text");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(pageSubmissions[0]).toEqual({
        body: "New text",
        commentId: "c1",
        intent: "edit-comment",
      }),
    );
  });

  it("deletes after confirmation and shows a refusal", async () => {
    const { pageSubmissions } = renderPanel([thread("c1")], null, {
      pageAnswers: { "edit-comment": { error: "forbidden", ok: false } },
    });

    await userEvent.click(
      await screen.findByRole("button", { name: "Delete comment" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Delete comment?",
    });

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete comment" }),
    );
    await waitFor(() =>
      expect(pageSubmissions[0]).toEqual({
        commentId: "c1",
        intent: "delete-comment",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: "Edit comment" }));
    await userEvent.type(screen.getByLabelText("Comment text"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("You lack the permission for this."),
    ).toBeVisible();
  });

  it("hides edit and delete from people who may not change the comment", async () => {
    renderPanel([thread("c1", { canChange: false, canEdit: false })]);

    await screen.findByText("Body of c1");

    expect(screen.queryByRole("button", { name: "Edit comment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete comment" })).toBeNull();
  });
});

describe("WikiFeedView", () => {
  const item = (overrides: Partial<WikiFeedItem>): WikiFeedItem => ({
    actorName: "Max",
    at: "2026-01-02 10:00:00",
    excerpt: "Please look",
    isUnread: true,
    pageId: "p1",
    pageTitle: "Guide",
    reason: "mention",
    ...overrides,
  });

  it("lists entries with the reason and marks unread ones", async () => {
    const { layoutSubmissions } = renderInWiki(
      <WikiFeedView
        feed={[
          item({}),
          item({ excerpt: "", isUnread: false, reason: "expired" }),
          item({ reason: "reply" }),
          item({ reason: "comment" }),
        ]}
      />,
    );

    expect(await screen.findByText(/Max mentioned you/)).toBeVisible();
    expect(
      screen.getByText("The page is no longer current", { exact: false }),
    ).toBeVisible();
    expect(screen.getByText(/Max replied to your comment/)).toBeVisible();
    expect(screen.getByText(/Max commented on your page/)).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "For me (3 new)" }),
    ).toBeVisible();
    expect(screen.getAllByText("New")).toHaveLength(3);

    await userEvent.click(screen.getByRole("button", { name: "Mark as read" }));

    await waitFor(() =>
      expect(layoutSubmissions[0]).toEqual({ intent: "mark-feed-read" }),
    );
  });

  it("offers no mark-as-read button when everything was read", async () => {
    renderInWiki(<WikiFeedView feed={[item({ isUnread: false })]} />);

    await screen.findByText(/Max mentioned you/);

    expect(screen.queryByRole("button", { name: "Mark as read" })).toBeNull();
    expect(screen.getByRole("heading", { name: "For me" })).toBeVisible();
  });

  it("says when nothing concerns the person", async () => {
    renderInWiki(<WikiFeedView feed={[]} />);

    expect(await screen.findByText("Nothing for you right now.")).toBeVisible();
  });
});

describe("page screen with comments", () => {
  beforeAll(installEditorGeometry);
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.getSelection()?.removeAllRanges();
  });

  const PAGE: WikiPage = {
    anchors: [],
    breadcrumb: [],
    content: "Some text with a commented passage in it",
    cover: null,
    createdAt: "2026-01-01 10:00:00",
    currentUntil: null,
    icon: null,
    id: "p1",
    isTemplate: false,
    ownerId: "o1",
    ownerName: "Olga",
    parentId: null,
    projectId: null,
    projectName: null,
    revision: 1,
    scope: "instance",
    title: "Guide",
    updatedAt: "2026-01-02 10:00:00",
    updatedByName: "Olga",
  };

  function renderScreen(threads: readonly WikiCommentThread[], canEdit = true) {
    return renderInWiki(
      <WikiPageScreen
        anchorChoices={{
          departments: [],
          epics: [],
          milestones: [],
          selected: [],
        }}
        attachments={[]}
        backlinks={{ pages: [], projects: [], tickets: [] }}
        comments={threads}
        navigation={{
          canCreate: true,
          expandedIds: [],
          favoriteIds: [],
          nodes: [],
          projects: [],
          recent: [],
        }}
        owners={[]}
        templates={[]}
        today="2026-10-07"
        versions={[]}
        view={{
          children: [],
          isFavorite: false,
          page: PAGE,
          permissions: { canComment: true, canEdit, canManage: canEdit },
        }}
      />,
      { path: "/wiki/p1" },
    );
  }

  it("highlights open commented passages and offers to comment on a selection", async () => {
    class FakeHighlight {
      public readonly ranges: Range[];

      public constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    }

    vi.stubGlobal("Highlight", FakeHighlight);
    vi.stubGlobal("CSS", { highlights: new Map() });
    renderScreen([
      thread("c1", { quote: "commented passage" }),
      thread("c2", { quote: "resolved", resolvedAt: "2026-01-03 10:00:00" }),
      thread("c3"),
    ]);

    await screen.findByText(/Some text with/);

    const highlights = (
      CSS as unknown as { highlights: Map<string, { ranges: Range[] }> }
    ).highlights;

    await waitFor(() =>
      expect(highlights.get("wiki-comment")?.ranges.map(String)).toEqual([
        "commented passage",
      ]),
    );

    const text = screen.getByText(/Some text with/).firstChild as Text;

    act(() => {
      window.getSelection()?.setBaseAndExtent(text, 5, text, 9);
      document.dispatchEvent(new Event("selectionchange"));
    });

    await userEvent.click(
      await screen.findByRole("button", { name: "Comment on selection" }),
    );

    expect(screen.getByText("text")).toBeVisible();
  });

  it("marks passages in the text of readers too", async () => {
    vi.stubGlobal("Highlight", class {});
    vi.stubGlobal("CSS", { highlights: new Map() });
    renderScreen([thread("c1", { quote: "commented passage" })], false);

    expect(await screen.findByText(/Some text with/)).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Page text" })).toBeNull();
    await waitFor(() =>
      expect(
        (CSS as unknown as { highlights: Map<string, unknown> }).highlights.has(
          "wiki-comment",
        ),
      ).toBe(true),
    );
  });

  it("comments on the passage selected in the editor", async () => {
    renderScreen([]);

    const element = await screen.findByRole("textbox", { name: "Page text" });
    const { editor } = element as unknown as { editor: Editor };

    act(() => {
      editor.commands.focus();
      editor.commands.setTextSelection({ from: 6, to: 10 });
    });

    const toolbar = await screen.findByRole("toolbar", { name: "Formatting" });

    act(() => {
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
    });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Comment" }));
    expect(screen.queryByText("text")).toBeNull();

    const text = within(element).getByText(/Some text with/).firstChild as Text;

    act(() => {
      window.getSelection()?.setBaseAndExtent(text, 5, text, 9);
      document.dispatchEvent(new Event("selectionchange"));
    });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Comment" }));

    expect(await screen.findByText("text")).toBeVisible();
    expect(screen.getByLabelText(/Write a comment/)).toBeVisible();
  });
});
