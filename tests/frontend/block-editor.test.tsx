// @vitest-environment jsdom
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { undoDepth } from "@tiptap/pm/history";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { BlockEditor } from "@/app/components/editor/block-editor";
import {
  addBlockBelow,
  startBlockDrag,
} from "@/app/components/editor/editor-block-handle";
import { findBlockAtPoint } from "@/app/components/editor/use-hovered-block";
import { createI18n } from "@/app/lib/i18n";
import { serializeMarkdown } from "@/app/lib/editor/editor-markdown";
import { LANGUAGE } from "@/language/Language";

import {
  installEditorGeometry,
  renderBlockEditor,
  typeText,
} from "../helpers/editor";

import type { Editor } from "@tiptap/core";
import type { RenderEditorOptions } from "../helpers/editor";

beforeAll(installEditorGeometry);

async function ready(markdown: string, options: RenderEditorOptions = {}) {
  const rendered = renderBlockEditor(markdown, options);

  await waitFor(() => expect(rendered.onReady).toHaveBeenCalled());

  const { element } = rendered.handle();
  const { editor } = element as unknown as { editor: Editor };

  return { ...rendered, editor, element };
}

function press(
  editor: Editor,
  key: string,
  init: KeyboardEventInit = {},
): void {
  act(() => {
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
        ...init,
      }),
    );
  });
}

describe("BlockEditor", () => {
  it("keeps the sidebar shortcut inert when no text assistant is available", async () => {
    const { editor } = await ready("Original\n");
    press(editor, "j", { ctrlKey: true, altKey: true, shiftKey: true });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(serializeMarkdown(editor.state.doc, null)).toBe("Original\n");
  });

  it("renders the fallback on the server, where the editor does not run", () => {
    const html = renderToString(
      createElement(
        I18nextProvider,
        { i18n: createI18n(LANGUAGE.GERMAN) },
        createElement(
          MemoryRouter,
          null,
          createElement(BlockEditor, {
            fallback: createElement("p", null, "server fallback"),
            features: { isDisplayableImage: () => false },
            isEditable: true,
            label: "Text",
            markdown: "# a",
          }),
        ),
      ),
    );

    expect(html).toContain("server fallback");
  });

  it("hands out controls to read, replace and focus the document and withdraws them", async () => {
    const { handle, onReady, unmount, editor } = await ready("*a*\n");

    expect(handle().getMarkdown()).toBe("*a*\n");
    act(() => handle().replaceMarkdown("__b__\n\nc\n"));
    expect(handle().getMarkdown()).toBe("__b__\n\nc\n");
    expect(editor.can().undo()).toBe(false);
    act(() => handle().focusStart());
    expect(editor.state.selection.from).toBe(1);
    unmount();
    expect(onReady).toHaveBeenLastCalledWith(null);
  });

  it("reports the markdown after every change", async () => {
    const onChange = vi.fn();
    const { editor } = await ready("a\n", { onChange });

    act(() => {
      editor.commands.setTextSelection(2);
      typeText(editor, "b");
    });
    expect(onChange).toHaveBeenLastCalledWith("ab\n");
  });

  it("shows callouts, toggles, source blocks, the table of contents and images", async () => {
    const { container, editor } = await ready(
      "# One\n\n## Two\n\n> [!TIP]\n> t\n\n> [!TOGGLE] Sum\n> body\n\n<b>raw</b>\n\n[toc]\n\n![a](/wiki/attachments/a) ![b](https://example.com/b.png)\n",
      { features: { isDisplayableImage: (src) => src.startsWith("/wiki/") } },
    );

    expect(
      screen.getByRole("button", { name: "Art des Hinweises: Tipp" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Markdown-Quelltext/)).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("navigation", { name: "Inhaltsverzeichnis" }),
      ).getByText("Two"),
    ).toBeInTheDocument();
    expect(
      container.querySelector('img[src="/wiki/attachments/a"]'),
    ).not.toBeNull();
    expect(
      screen.getByText("Bild wird nicht angezeigt: b"),
    ).toBeInTheDocument();

    const toggle = screen.getByRole("button", {
      name: "Ausklappbereich öffnen",
    });
    const depth = undoDepth(editor.state);

    fireEvent.click(toggle);
    expect(editor.state.doc.child(3).attrs.open).toBe(true);
    expect(
      await screen.findByRole("button", { name: "Ausklappbereich schließen" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(undoDepth(editor.state)).toBe(depth);
    fireEvent.click(
      screen.getByRole("button", { name: "Ausklappbereich schließen" }),
    );
    expect(editor.state.doc.child(3).attrs.open).toBe(false);
    expect(
      await screen.findByRole("button", { name: "Ausklappbereich öffnen" }),
    ).toBeInTheDocument();
  });

  it("lists no headings in an empty table of contents and names images without alt text", async () => {
    await ready("[toc]\n\n![](https://x.example/y.png)\n", {
      features: { isDisplayableImage: () => false },
    });

    expect(screen.getByText("Noch keine Überschriften.")).toBeInTheDocument();
    expect(
      screen.getByText("Bild wird nicht angezeigt: https://x.example/y.png"),
    ).toBeInTheDocument();
  });

  it("changes the kind of a callout from its icon", async () => {
    const { editor } = await ready("> [!NOTE]\n> n\n");

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Art des Hinweises: Notiz" }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Warnung" }));
    expect(serializeMarkdown(editor.state.doc, null)).toBe(
      "> [!WARNING]\n> n\n",
    );
  });

  it("keeps callouts unchangeable and hides the editing tools while reading", async () => {
    await ready("> [!NOTE]\n> n\n", { isEditable: false });

    expect(
      screen.getByRole("button", { name: "Art des Hinweises: Notiz" }),
    ).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Blockaktionen" })).toBeNull();
  });

  it("toggles a toggle that is not part of the document any more without failing", async () => {
    const { editor } = await ready("> [!TOGGLE] S\n");
    const toggle = screen.getByRole("button", {
      name: "Ausklappbereich öffnen",
    });

    vi.spyOn(editor.view, "dispatch");
    act(() => {
      editor.commands.setContent("<p>gone</p>");
    });
    fireEvent.click(toggle);
    expect(serializeMarkdown(editor.state.doc, null)).toBe("gone\n");
  });
});

describe("menus that open while typing", () => {
  it("inserts blocks from the slash menu by keyboard and pointer", async () => {
    const { editor } = await ready("\n");

    act(() => typeText(editor, "/"));
    const list = await screen.findByRole("listbox", { name: "Blöcke" });

    expect(
      within(list).getByRole("option", { name: /Textassistenz/ }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(editor.view.dom).toHaveAttribute("aria-expanded", "true");
    act(() => typeText(editor, "überschrift"));
    await waitFor(() =>
      expect(
        within(screen.getByRole("listbox", { name: "Blöcke" })).getAllByRole(
          "option",
        ),
      ).toHaveLength(3),
    );
    press(editor, "ArrowDown");
    press(editor, "Enter");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(editor.state.doc.firstChild?.attrs.level).toBe(2);
    expect(editor.view.dom).not.toHaveAttribute("aria-expanded");

    act(() => {
      editor.commands.setContent("<p></p>");
      editor.commands.focus("end");
      typeText(editor, "/trenn");
    });
    const option = await screen.findByRole("option", { name: /Trennlinie/ });

    fireEvent.mouseEnter(option);
    fireEvent.mouseDown(option);
    fireEvent.click(option);
    expect(editor.state.doc.firstChild?.type.name).toBe("horizontalRule");
  });

  it("shows a hint when nothing matches", async () => {
    const { editor } = await ready("\n");

    act(() => typeText(editor, "/qqq"));
    expect(await screen.findByText("Keine Treffer")).toBeInTheDocument();
  });

  it("asks for files, the emoji picker and subpages from the slash menu", async () => {
    const createPage = vi.fn(async () => ({
      href: "/wiki/s",
      icon: null,
      title: "Sub",
    }));
    const uploadFiles = vi.fn(async () => []);
    const { editor, container } = await ready("\n", {
      features: { createPage, uploadFiles },
    });
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    const click = vi.spyOn(input as HTMLInputElement, "click");

    act(() => typeText(editor, "/bild"));
    fireEvent.click(
      await screen.findByRole("option", { name: /Bild oder Datei/ }),
    );
    expect(click).toHaveBeenCalled();
    act(() => typeText(editor, "/emoji"));
    fireEvent.click(await screen.findByRole("option", { name: /Emoji/ }));
    expect(
      await screen.findByRole("dialog", { name: "Emoji einfügen" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "🚀" }));
    expect(serializeMarkdown(editor.state.doc, null)).toBe("🚀\n");
    act(() => {
      editor.commands.setContent("<p></p>");
      typeText(editor, "/unterseite");
    });
    fireEvent.click(await screen.findByRole("option", { name: /Unterseite/ }));
    await waitFor(() =>
      expect(serializeMarkdown(editor.state.doc, null)).toBe(
        "[Sub](/wiki/s)\n",
      ),
    );
  });

  it("inserts pages, tickets and people from the reference menu", async () => {
    const findReferences = vi.fn(async (query: string) =>
      query === "pa"
        ? [
            {
              hint: "Seite",
              insertion: {
                href: "/wiki/p",
                kind: "link" as const,
                text: "Page",
              },
              key: "page:p",
              label: "📘 Page",
            },
          ]
        : [],
    );
    const { editor } = await ready("\n", { features: { findReferences } });

    act(() => typeText(editor, "[[pa"));
    expect(
      await screen.findByRole("option", { name: /Page/ }),
    ).toBeInTheDocument();
    press(editor, "Enter");
    await waitFor(() =>
      expect(serializeMarkdown(editor.state.doc, null)).toBe(
        "[Page](/wiki/p)\n",
      ),
    );
    act(() => typeText(editor, "@x"));
    expect(await screen.findByText("Keine Treffer")).toBeInTheDocument();
    expect(findReferences).toHaveBeenCalledWith("x");
  });

  it("offers no references without the feature", async () => {
    const { editor } = await ready("\n");

    act(() => typeText(editor, "[[a"));
    expect(await screen.findByText("Keine Treffer")).toBeInTheDocument();
  });

  it("inserts emoji after a colon and two letters", async () => {
    const { editor } = await ready("\n");

    act(() => typeText(editor, ":rake"));
    expect(
      await screen.findByRole("option", { name: /🚀/ }),
    ).toBeInTheDocument();
    press(editor, "Enter");
    await waitFor(() =>
      expect(serializeMarkdown(editor.state.doc, null)).toBe("🚀\n"),
    );
  });

  it("opens no menu inside code", async () => {
    const { editor } = await ready("```\n\n```\n");

    act(() => {
      editor.commands.setTextSelection(1);
      typeText(editor, "/");
    });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("block handle", () => {
  it("shows the handle for the block under the pointer and hides it on leaving and typing", async () => {
    const { editor, container } = await ready("one\n\ntwo\n");
    const wrapper = container.querySelector(".relative") as HTMLElement;

    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ inside: 5, pos: 6 });
    fireEvent.mouseMove(wrapper, { clientX: 5, clientY: 30 });
    expect(
      await screen.findByRole("button", { name: "Blockaktionen" }),
    ).toBeInTheDocument();
    fireEvent.mouseMove(wrapper, { clientX: 6, clientY: 31 });
    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByRole("button", { name: "Blockaktionen" })).toBeNull();
    fireEvent.mouseMove(wrapper, { clientX: 5, clientY: 30 });
    fireEvent.keyDown(editor.view.dom, { key: "a" });
    expect(screen.queryByRole("button", { name: "Blockaktionen" })).toBeNull();
  });

  it("finds no block outside of the text", async () => {
    const { editor, container } = await ready("one\n");

    vi.spyOn(editor.view, "posAtCoords")
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ inside: -1, pos: 0 });
    expect(findBlockAtPoint(editor, container, { x: 1, y: 1 })).toBeNull();
    vi.spyOn(editor.view, "nodeDOM").mockReturnValueOnce(null);
    expect(findBlockAtPoint(editor, container, { x: 1, y: 1 })).toBeNull();
  });

  it("adds a block below and opens the slash menu in it", async () => {
    const { editor, container } = await ready("one\n\ntwo\n");
    const wrapper = container.querySelector(".relative") as HTMLElement;

    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ inside: 0, pos: 1 });
    fireEvent.mouseMove(wrapper, { clientX: 5, clientY: 30 });
    fireEvent.click(
      await screen.findByRole("button", { name: "Block darunter einfügen" }),
    );
    expect(
      await screen.findByRole("listbox", { name: "Blöcke" }),
    ).toBeInTheDocument();
    expect(editor.state.doc.child(1).textContent).toBe("/");
  });

  it("duplicates the block of the handle from the block menu", async () => {
    const { editor, container } = await ready("one\n\ntwo\n");
    const wrapper = container.querySelector(".relative") as HTMLElement;

    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ inside: 0, pos: 1 });
    fireEvent.mouseMove(wrapper, { clientX: 5, clientY: 30 });
    fireEvent.click(
      await screen.findByRole("button", { name: "Blockaktionen" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Duplizieren/ }),
    );
    await waitFor(() =>
      expect(serializeMarkdown(editor.state.doc, null)).toBe(
        "one\n\none\n\ntwo\n",
      ),
    );
  });

  it("turns the block of the handle into another type through the submenu", async () => {
    const { editor, container } = await ready("one\n\ntwo\n");
    const wrapper = container.querySelector(".relative") as HTMLElement;

    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ inside: 5, pos: 6 });
    fireEvent.mouseMove(wrapper, { clientX: 5, clientY: 30 });
    fireEvent.click(
      await screen.findByRole("button", { name: "Blockaktionen" }),
    );
    const trigger = await screen.findByRole("menuitem", {
      name: "Umwandeln in",
    });

    fireEvent.keyDown(trigger, { key: "ArrowRight" });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Überschrift 1/ }),
    );
    await waitFor(() =>
      expect(serializeMarkdown(editor.state.doc, null)).toBe("one\n\n# two\n"),
    );
  });

  it("drags a block as a whole and ignores places without a block", async () => {
    const { editor } = await ready("one\n\ntwo\n");
    const data = { effectAllowed: "", setData: vi.fn(), setDragImage: vi.fn() };

    startBlockDrag(editor, 5, {
      dataTransfer: data,
    } as unknown as React.DragEvent<HTMLElement>);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.view.dragging?.move).toBe(true);
    expect(data.setData).toHaveBeenCalledWith("text/plain", "two");
    expect(data.setDragImage).toHaveBeenCalled();

    vi.spyOn(editor.view, "nodeDOM").mockReturnValueOnce(null);
    startBlockDrag(editor, 0, {
      dataTransfer: data,
    } as unknown as React.DragEvent<HTMLElement>);
    expect(data.setDragImage).toHaveBeenCalledTimes(1);
    addBlockBelow(editor, 999);
    expect(editor.state.doc.childCount).toBe(2);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)),
    );
  });
});
