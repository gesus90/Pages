// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWikiEditorText } from "@/app/components/wiki/use-wiki-editor-text";
import type { WikiEditorTextState } from "@/app/components/wiki/use-wiki-editor-text";
import { WikiEditor } from "@/app/components/wiki/wiki-editor";
import { WikiEditorMenu } from "@/app/components/wiki/wiki-editor-menu";

import { renderInWiki } from "../helpers/wiki-render";

import type { WikiPage } from "@/definition/Wiki";

const PAGE: WikiPage = {
  anchors: [],
  breadcrumb: [],
  content: "Hello",
  createdAt: "2026-01-01 10:00:00",
  currentUntil: null,
  icon: "📘",
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

function saved(overrides: Partial<WikiPage> = {}) {
  return { ok: true, page: { ...PAGE, revision: 2, ...overrides } };
}

function setup(
  options: Parameters<typeof renderInWiki>[1] = {},
  page: WikiPage = PAGE,
) {
  const onDone = vi.fn();
  const rendered = renderInWiki(<WikiEditor page={page} onDone={onDone} />, {
    path: "/wiki/p1",
    ...options,
  });

  return { ...rendered, onDone };
}

async function content(): Promise<HTMLTextAreaElement> {
  return (await screen.findByLabelText(
    "Page text (Markdown)",
  )) as HTMLTextAreaElement;
}

async function wait(milliseconds: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(milliseconds);
}

describe("WikiEditor", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function typist() {
    return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  }

  it("shows the page with a live preview", async () => {
    setup();

    const textarea = await content();
    const user = typist();

    expect(textarea).toHaveValue("Hello");
    expect(screen.getByLabelText("Page title")).toHaveValue("Guide");
    expect(screen.getByLabelText("Preview")).toHaveTextContent("Hello");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");

    await user.type(textarea, " world");

    expect(screen.getByLabelText("Preview")).toHaveTextContent("Hello world");
    expect(screen.getByRole("status")).toHaveTextContent("Not saved");
  });

  it("saves a moment after typing against the loaded revision", async () => {
    const { pageSubmissions } = setup({
      pageAnswers: { save: saved({ content: "Hello!" }) },
    });
    const user = typist();

    await user.type(await content(), "!");
    await wait(1300);

    await waitFor(() => expect(pageSubmissions).toHaveLength(1));
    expect(pageSubmissions[0]).toEqual({
      content: "Hello!",
      expectedRevision: "1",
      icon: "📘",
      intent: "save",
      title: "Guide",
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Saved"),
    );
  });

  it("normalizes the title before it counts as changed", async () => {
    const { pageSubmissions } = setup();
    const user = typist();

    await user.type(await screen.findByLabelText("Page title"), "  ");
    await wait(1500);

    expect(pageSubmissions).toEqual([]);
  });

  it("does not save an empty title or a text over the limit", async () => {
    const { pageSubmissions } = setup();
    const user = typist();

    await user.clear(await screen.findByLabelText("Page title"));
    await wait(1500);
    fireEvent.change(await content(), {
      target: { value: "x".repeat(200_001) },
    });
    await wait(1500);

    expect(pageSubmissions).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent("Too long");
    expect(screen.getByText("200001 / 200000")).toBeVisible();
  });

  it("shows counters near the limits", async () => {
    setup();

    fireEvent.change(await screen.findByLabelText("Page title"), {
      target: { value: "t".repeat(170) },
    });

    expect(screen.getByText("170 / 200")).toBeVisible();
  });

  it("finishes after saving what is open", async () => {
    const { onDone } = setup({
      pageAnswers: { save: saved({ content: "Hello!" }) },
    });
    const user = typist();

    await user.type(await content(), "!");
    await user.click(screen.getByRole("button", { name: "Done" }));
    await wait(100);

    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Hello!", revision: 2 }),
      ),
    );
  });

  it("finishes at once when everything is saved", async () => {
    const { onDone } = setup();

    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(await screen.findByRole("button", { name: "Done" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(PAGE));
  });

  it("offers the ways out of a conflict", async () => {
    const theirs = {
      content: "Theirs",
      icon: null,
      revision: 3,
      title: "Their title",
    };
    const { pageSubmissions } = setup({
      pageAnswers: {
        save: { current: { ...PAGE, ...theirs }, error: "conflict", ok: false },
      },
    });
    const user = typist();

    await user.type(await content(), "!");
    await wait(1300);

    const dialog = await screen.findByRole("dialog", {
      name: "The page was changed in the meantime",
    });

    expect(screen.getByRole("status")).toHaveTextContent("Conflict");

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Take their version" }),
    );

    expect(await content()).toHaveValue("Theirs");
    expect(screen.getByLabelText("Page title")).toHaveValue("Their title");
    expect(pageSubmissions).toHaveLength(1);
  });

  it("keeps my version on top of the newer revision", async () => {
    const { pageSubmissions } = setup({
      pageAnswers: {
        save: {
          current: { ...PAGE, content: "Theirs", revision: 3 },
          error: "conflict",
          ok: false,
        },
      },
    });
    const user = typist();

    await user.type(await content(), "!");
    await wait(1300);
    fireEvent.click(
      await screen.findByRole("button", { name: "Keep my version" }),
    );
    await wait(1300);

    await waitFor(() => expect(pageSubmissions).toHaveLength(2));
    expect(pageSubmissions[1]).toMatchObject({
      content: "Hello!",
      expectedRevision: "3",
    });
  });

  it("shows a failed save and tries again after the next change", async () => {
    const { pageSubmissions } = setup({
      pageAnswers: { save: { error: "forbidden", ok: false } },
    });
    const user = typist();

    await user.type(await content(), "!");
    await wait(1300);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Saving failed – You lack the permission for this.",
      ),
    );

    await user.type(await content(), "?");
    await wait(1300);

    await waitFor(() => expect(pageSubmissions).toHaveLength(2));
  });

  it("applies toolbar commands to the selection", async () => {
    setup();

    const textarea = await content();
    const user = typist();

    textarea.setSelectionRange(0, 5);
    await user.click(screen.getByRole("button", { name: "Bold" }));

    expect(textarea).toHaveValue("**Hello**");
  });

  it("opens the slash menu at the start of a line and picks with the keyboard", async () => {
    setup({}, { ...PAGE, content: "" });

    const textarea = await content();
    const user = typist();

    await user.click(textarea);
    await user.keyboard("/hea");

    const menu = screen.getByRole("listbox", { name: "Blocks" });

    expect(
      within(menu)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Heading 1", "Heading 2", "Heading 3"]);
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}{Enter}");

    expect(textarea).toHaveValue("## ");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("picks with Tab or the mouse and closes with Escape", async () => {
    setup({}, { ...PAGE, content: "" });

    const textarea = await content();
    const user = typist();

    await user.click(textarea);
    await user.keyboard("/quo{Tab}");

    expect(textarea).toHaveValue("> ");

    await user.clear(textarea);
    await user.keyboard("/tab");
    await user.click(screen.getByRole("option", { name: "Table" }));

    expect(textarea.value).toContain("| Column 1 | Column 2 |");

    await user.clear(textarea);
    await user.keyboard("/b");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("explains an empty slash menu and lets other keys through", async () => {
    setup({}, { ...PAGE, content: "" });

    const textarea = await content();
    const user = typist();

    await user.click(textarea);
    await user.keyboard("/zzz");

    expect(screen.getByText("No matches")).toBeVisible();

    await user.keyboard("{Enter}");

    expect(textarea).toHaveValue("/zzz\n");
  });

  it("continues lists on Enter and tracks the caret", async () => {
    setup({}, { ...PAGE, content: "" });

    const textarea = await content();
    const user = typist();

    await user.click(textarea);
    await user.keyboard("- one{Enter}two");

    expect(textarea).toHaveValue("- one\n- two");

    await user.keyboard("{ArrowLeft}{Home}");
    await user.click(textarea);
  });

  it("chooses and removes the icon", async () => {
    const { pageSubmissions } = setup({
      pageAnswers: { save: saved({ icon: "🚀" }) },
    });
    const user = typist();

    await user.click(await screen.findByRole("button", { name: "Page icon" }));
    await user.click(await screen.findByRole("menuitem", { name: "🚀" }));
    await wait(1300);

    await waitFor(() =>
      expect(pageSubmissions[0]).toMatchObject({ icon: "🚀" }),
    );

    await user.click(screen.getByRole("button", { name: "Page icon" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Remove icon" }),
    );
    await wait(1300);

    await waitFor(() => expect(pageSubmissions[1]).toMatchObject({ icon: "" }));
  });

  it("shows an empty icon button for a page without icon", async () => {
    setup({}, { ...PAGE, icon: null });

    expect(
      await screen.findByRole("button", { name: "Page icon" }),
    ).toBeVisible();
  });

  it("switches between writing and preview on small screens", async () => {
    setup();

    const user = typist();

    await user.click(await screen.findByRole("button", { name: "Preview" }));

    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByRole("button", { name: "Edit" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("warns before the browser leaves while there are unsaved changes", async () => {
    setup();

    const user = typist();
    const clean = new Event("beforeunload", { cancelable: true });

    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    await user.type(await content(), "!");

    const dirty = new Event("beforeunload", { cancelable: true });

    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});

describe("WikiEditor reference picker", () => {
  const references = {
    references: [
      { icon: "📘", id: "page-1", kind: "page", title: "Plan [v2]" },
      { icon: null, id: "page-2", kind: "page", title: "No icon" },
      { key: "PAG-4", kind: "ticket", title: "Fix it" },
      { displayName: "Ada L.", id: "u1", kind: "person", username: "ada" },
    ],
  };

  function setupPicker(content = "") {
    return setup(
      { endpoints: { "/wiki-api/references": () => references } },
      { ...PAGE, content },
    );
  }

  it("links a page after [[", async () => {
    const { loads } = setupPicker();
    const textarea = await content();
    const user = userEvent.setup();

    await user.click(textarea);
    // In user-event, "[[" types one bracket.
    await user.keyboard("see [[[[pl");

    const menu = await screen.findByRole("listbox", { name: "Link" });

    expect(within(menu).getAllByRole("option")).toHaveLength(4);
    expect(loads.at(-1)).toBe("/wiki-api/references?q=pl");
    await user.click(within(menu).getByRole("option", { name: /Plan/ }));

    expect(textarea).toHaveValue("see [Plan \\[v2\\]](/wiki/page-1)");
  });

  it("links a ticket and mentions a person with the keyboard", async () => {
    setupPicker();

    const textarea = await content();
    const user = userEvent.setup();

    await user.click(textarea);
    await user.keyboard("[[[[x");
    await screen.findByRole("listbox", { name: "Link" });
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(textarea).toHaveValue("[PAG-4](/aufgaben/PAG-4)");

    await user.clear(textarea);
    await user.keyboard("hi @a");
    await screen.findByRole("option", { name: /Ada L./ });
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Tab}");

    expect(textarea).toHaveValue("hi @ada ");
  });

  it("closes the picker with Escape", async () => {
    setupPicker();

    const user = userEvent.setup();

    await user.click(await content());
    await user.keyboard("@a");
    await screen.findByRole("listbox", { name: "Link" });
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("editor pieces without a mounted text area", () => {
  it("ignores commands before the text area exists", async () => {
    const setContent = vi.fn();
    let state: WikiEditorTextState | undefined;

    function Probe(): React.ReactElement {
      state = useWikiEditorText("text", setContent);

      return <p>probe</p>;
    }

    renderInWiki(<Probe />);
    await screen.findByText("probe");

    state?.runCommand("bold");
    state?.insertText("text");
    state?.pickItem("bold");
    state?.handleCaretMove();

    expect(setContent).not.toHaveBeenCalled();
  });

  it("ignores a menu key that is neither a block nor a reference", async () => {
    let state: WikiEditorTextState | undefined;

    function Probe(): React.ReactElement {
      const [value, setValue] = useState("");

      state = useWikiEditorText(value, setValue);

      return (
        <textarea
          ref={state.textareaRef}
          aria-label="probe"
          value={value}
          onChange={state.handleChange}
        />
      );
    }

    renderInWiki(<Probe />);
    await userEvent.type(await screen.findByLabelText("probe"), "/");
    await act(async () => state?.pickItem("bogus"));

    expect(screen.getByLabelText("probe")).toHaveValue("/");
  });

  it("shows the hint of a menu entry", () => {
    render(
      <WikiEditorMenu
        activeIndex={0}
        emptyLabel="none"
        items={[{ hint: "Page", key: "a", label: "Alpha" }]}
        label="Menu"
        onPick={vi.fn()}
      />,
    );

    expect(screen.getByRole("option")).toHaveTextContent("AlphaPage");
  });
});
