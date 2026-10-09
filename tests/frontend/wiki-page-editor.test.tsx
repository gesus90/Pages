// @vitest-environment jsdom
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { WikiPageEditor } from "@/app/components/wiki/wiki-page-editor";

import { installEditorGeometry, typeText } from "../helpers/editor";
import { renderInWiki } from "../helpers/wiki-render";

import type { Editor } from "@tiptap/core";
import type { WikiRenderOptions } from "../helpers/wiki-render";
import type { WikiPage } from "@/definition/Wiki";

const PAGE: WikiPage = {
  anchors: [],
  breadcrumb: [],
  content: "Mine",
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

/** Long enough for the autosave delay of 1.2 seconds. */
const SAVE_WAIT = { timeout: 4000 };

beforeAll(installEditorGeometry);

function renderEditor(
  page: Partial<WikiPage> = {},
  options: WikiRenderOptions = {},
) {
  const callbacks = {
    onComment: vi.fn(),
    onSaved: vi.fn(),
    onTextChange: vi.fn(),
    onTextElement: vi.fn(),
  };
  const rendered = renderInWiki(
    <WikiPageEditor
      attachments={[]}
      meta={<p>Meta line</p>}
      page={{ ...PAGE, ...page }}
      {...callbacks}
    />,
    { path: "/wiki/p1", ...options },
  );

  return { ...rendered, ...callbacks };
}

async function editorOf(
  timeout = 1000,
): Promise<{ editor: Editor; element: HTMLElement }> {
  const element = await screen.findByRole(
    "textbox",
    { name: "Page text" },
    { timeout },
  );

  return { editor: (element as unknown as { editor: Editor }).editor, element };
}

function typeAtEnd(editor: Editor, text: string): void {
  act(() => {
    editor.commands.focus("end");
    typeText(editor, text);
  });
}

describe("WikiPageEditor", () => {
  it("edits icon and title in place and continues in the text on Enter", async () => {
    const { onSaved, onTextElement, unmount } = renderEditor();
    const { element } = await editorOf();

    expect(screen.getByText("Meta line")).toBeVisible();
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
    expect(onTextElement).toHaveBeenLastCalledWith(element);
    expect(screen.getByText("Saved")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Add icon" }));
    await userEvent.click(
      within(
        await screen.findByRole("dialog", { name: "Page icon" }),
      ).getByRole("button", { name: "😀" }),
    );
    expect(screen.getByRole("button", { name: "Page icon" })).toHaveTextContent(
      "😀",
    );

    const title = screen.getByRole("textbox", { name: "Page title" });

    fireEvent.change(title, { target: { value: "" } });
    expect(screen.getByText("Title missing – not saved")).toBeVisible();
    fireEvent.change(title, { target: { value: "Better guide" } });
    expect(screen.getByText("Not saved")).toBeVisible();
    fireEvent.keyDown(title, { key: "Enter" });
    // At once, so the next key already lands in the text.
    expect(element).toHaveFocus();

    unmount();
    expect(onTextElement).toHaveBeenLastCalledWith(null);
  });

  it("opens and closes the cover choice", async () => {
    renderEditor();

    await userEvent.click(
      await screen.findByRole("button", { name: "Add cover" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Choose cover" }),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows the running save and names why saving failed", async () => {
    const { onTextChange } = renderEditor(
      {},
      {
        pageAnswers: {
          // A slow server, so the running save can be seen.
          get save() {
            return new Promise((resolve) => {
              setTimeout(() => resolve({ error: "forbidden", ok: false }), 300);
            });
          },
        },
      },
    );
    const { editor } = await editorOf();

    typeAtEnd(editor, "!");
    expect(onTextChange).toHaveBeenCalled();
    expect(await screen.findByText("Saving…", {}, SAVE_WAIT)).toBeVisible();

    await waitFor(
      () =>
        expect(screen.getByText(/Saving failed/)).toHaveTextContent(
          "Saving failed – You lack the permission for this.",
        ),
      SAVE_WAIT,
    );
    expect(screen.getByText(/Saving failed/)).toHaveClass("text-destructive");
  });

  it("counts characters near the limit and refuses to save above it", async () => {
    renderEditor({ content: "x".repeat(200_000) });
    // Reading a text at the limit takes a moment, more so with coverage.
    const { editor } = await editorOf(15_000);

    expect(screen.getByText("200000 / 200000")).not.toHaveClass(
      "text-destructive",
    );
    typeAtEnd(editor, "y");

    expect(await screen.findByText("200001 / 200000")).toHaveClass(
      "text-destructive",
    );
    expect(screen.getByText("Too long – will not be saved")).toHaveClass(
      "text-destructive",
    );
  }, 30_000);

  it("keeps the own version or takes the other one after a conflict", async () => {
    const theirs = { ...PAGE, content: "Theirs", revision: 3 };
    const { pageSubmissions } = renderEditor(
      {},
      {
        // A new answer object per request, as a server sends it.
        pageAnswers: {
          get save() {
            return { current: theirs, error: "conflict", ok: false };
          },
        },
      },
    );
    const { editor, element } = await editorOf();

    typeAtEnd(editor, "!");
    await userEvent.click(
      await screen.findByRole("button", { name: "Keep my version" }, SAVE_WAIT),
    );
    await waitFor(() => expect(pageSubmissions).toHaveLength(2), SAVE_WAIT);
    expect(pageSubmissions[1]).toMatchObject({
      content: "Mine!",
      expectedRevision: "3",
    });

    await userEvent.click(
      await screen.findByRole(
        "button",
        { name: "Take their version" },
        SAVE_WAIT,
      ),
    );
    expect(await within(element).findByText("Theirs")).toBeVisible();
    expect(screen.queryByText("Mine!")).toBeNull();
  });

  it("creates a subpage with /page, links it and opens it once saved", async () => {
    // The page had no final line break, so none is added.
    const linked = "Mine\n\n[Child](/wiki/p9)";
    const { pageSubmissions, router } = renderEditor(
      {},
      {
        layoutAnswers: {
          "create-page": {
            ok: true,
            page: { ...PAGE, id: "p9", title: "Child" },
          },
        },
        pageAnswers: {
          save: { ok: true, page: { ...PAGE, content: linked, revision: 2 } },
        },
      },
    );
    const { editor } = await editorOf();

    act(() => {
      editor.commands.focus("end");
      editor.commands.enter();
      typeText(editor, "/subpage");
    });
    fireEvent.click(await screen.findByRole("option", { name: /Subpage/ }));

    const dialog = await screen.findByRole("dialog", { name: "New subpage" });

    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Title" }),
      "Child",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Create page" }),
    );

    await waitFor(
      () => expect(router.state.location.pathname).toBe("/wiki/p9"),
      SAVE_WAIT,
    );
    expect(pageSubmissions[0]).toMatchObject({
      content: linked,
      intent: "save",
    });
  });

  it("inserts nothing when the subpage dialog is cancelled", async () => {
    const { router } = renderEditor();
    const { editor } = await editorOf();

    act(() => {
      editor.commands.focus("end");
      editor.commands.enter();
      typeText(editor, "/subpage");
    });
    fireEvent.click(await screen.findByRole("option", { name: /Subpage/ }));
    await userEvent.click(
      within(
        await screen.findByRole("dialog", { name: "New subpage" }),
      ).getByRole("button", { name: "Cancel" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(router.state.location.pathname).toBe("/wiki/p1");
    expect(screen.queryByRole("link", { name: "Child" })).toBeNull();
  });
});
