// @vitest-environment jsdom
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { openSlashMenu } from "@/app/components/editor/editor-mobile-toolbar";
import { shouldShowSelectionToolbar } from "@/app/components/editor/editor-selection-toolbar";
import { serializeMarkdown } from "@/app/lib/editor/editor-markdown";

import {
  installEditorGeometry,
  renderBlockEditor,
  typeText,
} from "../helpers/editor";

import type { Editor } from "@tiptap/core";
import type { RenderEditorOptions } from "../helpers/editor";

beforeAll(installEditorGeometry);

beforeEach(() => {
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: vi.fn(() => true),
  });
});

async function ready(markdown: string, options: RenderEditorOptions = {}) {
  const rendered = renderBlockEditor(markdown, options);

  await waitFor(() => expect(rendered.onReady).toHaveBeenCalled());

  const { element } = rendered.handle();
  const { editor } = element as unknown as { editor: Editor };

  return { ...rendered, editor, element };
}

const markdownOf = (editor: Editor): string =>
  serializeMarkdown(editor.state.doc, null);

function key(editor: Editor, name: string, init: KeyboardEventInit = {}): void {
  act(() => {
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: name,
        ...init,
      }),
    );
  });
}

async function openSubmenu(name: string | RegExp): Promise<void> {
  fireEvent.keyDown(await screen.findByRole("menuitem", { name }), {
    key: "ArrowRight",
  });
}

describe("context menu", () => {
  it("opens at the pointer inside the text only and closes with Escape", async () => {
    const { editor, container } = await ready("text\n");

    fireEvent.contextMenu(container.querySelector(".relative") as HTMLElement);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(editor.view.dom, { clientX: 20, clientY: 30 });
    const menu = await screen.findByRole("menu", { name: "Editormenü" });

    expect(
      within(menu).getByRole("menuitem", { name: /Kopieren/ }),
    ).toHaveAttribute("data-disabled");
    expect(
      within(menu).getByRole("menuitem", { name: /^EinfügenCtrl\+V/ }),
    ).not.toHaveAttribute("data-disabled");
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("copies, cuts and selects through the menu", async () => {
    const { editor } = await ready("text\n");

    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 5 });
    });
    key(editor, "F10", { shiftKey: true });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Kopieren/ }));
    key(editor, "ContextMenu");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Ausschneiden/ }),
    );
    key(editor, "ContextMenu");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Alles auswählen/ }),
    );
    expect(vi.mocked(document.execCommand).mock.calls).toEqual([
      ["copy"],
      ["cut"],
    ]);
    expect(editor.state.selection.from).toBe(0);
  });

  it("points to the shortcut when the browser refuses pasting from the menu", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const { editor } = await ready("text\n");

    key(editor, "ContextMenu");
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Einfügen/ }));
    expect(
      await screen.findByText(/Bitte Ctrl\+V verwenden/),
    ).toBeInTheDocument();
    key(editor, "ContextMenu");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Als Klartext einfügen/ }),
    );
    expect(
      await screen.findByText(/Bitte Ctrl\+Shift\+V verwenden/),
    ).toBeInTheDocument();
  });

  it("pastes from the clipboard when the browser allows it", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: async () => "pasted" },
    });
    const { editor } = await ready("\n");

    key(editor, "ContextMenu");
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Einfügen/ }));
    await waitFor(() => expect(markdownOf(editor)).toBe("pasted\n"));
  });

  it("undoes and redoes through the menu", async () => {
    const { editor } = await ready("\n");

    act(() => typeText(editor, "abc"));
    key(editor, "ContextMenu");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Rückgängig/ }),
    );
    expect(markdownOf(editor)).toBe("");
    key(editor, "ContextMenu");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Wiederholen/ }),
    );
    expect(markdownOf(editor)).toBe("abc\n");
  });

  it("formats the selection through the format submenu", async () => {
    const { editor } = await ready("text\n");

    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 5 });
    });

    for (const [name, expected] of [
      ["Fett", "**text**\n"],
      ["Kursiv", "**_text_**\n"],
      ["Durchgestrichen", "**_~~text~~_**\n"],
      ["Code", "**_~~`text`~~_**\n"],
    ] as const) {
      key(editor, "ContextMenu");
      await openSubmenu("Formatieren");
      fireEvent.click(
        await screen.findByRole("menuitem", { name: new RegExp(`^${name}`) }),
      );
      await waitFor(() => expect(markdownOf(editor)).toBe(expected));
    }

    key(editor, "ContextMenu");
    await openSubmenu("Formatieren");
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Link/ }));
    expect(
      await screen.findByRole("dialog", { name: "Link" }),
    ).toBeInTheDocument();
  });

  it("turns, duplicates, moves, links and deletes the selected block", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => undefined },
    });
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint8Array).fill(0);

      return array;
    });
    const { editor } = await ready("one\n\ntwo\n");

    act(() => {
      editor.commands.setTextSelection(7);
    });
    key(editor, "ContextMenu");
    await openSubmenu("Umwandeln in");
    fireEvent.click(await screen.findByRole("menuitem", { name: /Zitat/ }));
    await waitFor(() => expect(markdownOf(editor)).toBe("one\n\n> two\n"));

    for (const [name, expected] of [
      ["Duplizieren", "one\n\n> two\n\n> two\n"],
      ["Nach oben verschieben", "one\n\n> two\n\n> two\n"],
      ["Nach unten verschieben", "one\n\n> two\n\n> two\n"],
      ["Löschen", "one\n\n> two\n"],
    ] as const) {
      key(editor, "ContextMenu");
      await openSubmenu("Block");
      fireEvent.click(
        await screen.findByRole("menuitem", { name: new RegExp(`^${name}`) }),
      );
      await waitFor(() => expect(markdownOf(editor)).toBe(expected));
    }

    key(editor, "ContextMenu");
    await openSubmenu("Block");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Link zum Block kopieren/ }),
    );
    expect(
      await screen.findByText("Link zum Block kopiert."),
    ).toBeInTheDocument();
    expect(markdownOf(editor)).toContain("<!-- block:aaaaaaaa -->");
  });

  it("shows the link for manual copying and skips blocks that take no anchor", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const { editor } = await ready("one\n\n<div>x</div>\n", {
      features: {
        blockLink: (anchor) => `https://pages.example/wiki/p#block-${anchor}`,
      },
    });

    act(() => {
      editor.commands.setTextSelection(2);
    });
    key(editor, "ContextMenu");
    await openSubmenu("Block");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Link zum Block kopieren/ }),
    );
    expect(
      await screen.findByText(
        /Kopieren nicht erlaubt\. Link: https:\/\/pages\.example\/wiki\/p#block-/,
      ),
    ).toBeInTheDocument();
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    });
    key(editor, "ContextMenu");
    await openSubmenu("Block");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Link zum Block kopieren/ }),
    );
    expect(markdownOf(editor).match(/<!-- block:/g)).toHaveLength(1);
  });

  it("offers the text assistant actions as unavailable and opens them with Mod+J", async () => {
    const open = vi.fn();
    const { editor, unmount } = await ready("text\n");

    key(editor, "j", { ctrlKey: true });
    const menu = await screen.findByRole("menu", { name: "Textassistenz" });

    expect(
      within(menu).getByText("Die Textassistenz ist noch nicht verfügbar."),
    ).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: "Übersetzen" }),
    ).toHaveAttribute("data-disabled");
    fireEvent.keyDown(menu, { key: "Escape" });
    unmount();

    const connected = await ready("text\n", {
      features: { textAssistant: { open } },
    });

    key(connected.editor, "ContextMenu");
    await openSubmenu(/^TextassistenzCtrl\+J/);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Zusammenfassen" }),
    );
    expect(open).toHaveBeenCalled();
  });

  it("keeps copying and selecting while reading and opens the emoji picker from the menu", async () => {
    const { editor, unmount } = await ready("text\n", { isEditable: false });

    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 3 });
    });
    fireEvent.contextMenu(editor.view.dom);
    expect(
      await screen.findByRole("menuitem", { name: /Kopieren/ }),
    ).not.toHaveAttribute("data-disabled");
    expect(
      screen.getByRole("menuitem", { name: /Ausschneiden/ }),
    ).toHaveAttribute("data-disabled");
    expect(
      screen.getByRole("menuitem", { name: /Rückgängig/ }),
    ).toHaveAttribute("data-disabled");
    unmount();

    const writing = await ready("\n");

    key(writing.editor, "ContextMenu");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Emoji einfügen/ }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "🎉" }));
    expect(markdownOf(writing.editor)).toBe("🎉\n");
  });
});

describe("link dialog", () => {
  it("inserts a link with its text when nothing is selected and refuses unsafe addresses", async () => {
    const { editor } = await ready("\n");

    key(editor, "k", { ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Link" });

    fireEvent.change(within(dialog).getByLabelText("Adresse"), {
      target: { value: "javascript:alert(1)" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Übernehmen" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Diese Adresse ist nicht erlaubt.",
    );
    fireEvent.change(within(dialog).getByLabelText("Adresse"), {
      target: { value: "https://example.com" },
    });
    fireEvent.change(within(dialog).getByLabelText("Text"), {
      target: { value: "Beispiel" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Übernehmen" }));
    await waitFor(() =>
      expect(markdownOf(editor)).toBe("[Beispiel](https://example.com)\n"),
    );
  });

  it("uses the address as text, links a selection, and removes or keeps a link", async () => {
    const { editor } = await ready("word\n");

    key(editor, "k", { ctrlKey: true });
    fireEvent.change(await screen.findByLabelText("Adresse"), {
      target: { value: "/wiki/p" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }));
    await waitFor(() =>
      expect(markdownOf(editor)).toBe("[/wiki/p](/wiki/p)word\n"),
    );

    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 2 });
    });
    key(editor, "k", { ctrlKey: true });
    expect(await screen.findByLabelText("Adresse")).toHaveValue("/wiki/p");
    expect(
      within(screen.getByRole("dialog")).queryByLabelText("Text"),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText("Adresse"), {
      target: { value: "/wiki/q" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }));
    await waitFor(() => expect(markdownOf(editor)).toContain("(/wiki/q)"));

    key(editor, "k", { ctrlKey: true });
    fireEvent.click(
      await screen.findByRole("button", { name: "Link entfernen" }),
    );
    await waitFor(() => expect(markdownOf(editor)).not.toContain("/wiki/q)"));
    key(editor, "k", { ctrlKey: true });
    fireEvent.change(await screen.findByLabelText("Adresse"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("files", () => {
  it("uploads chosen, pasted and dropped files and leaves other pastes to the editor", async () => {
    const uploadFiles = vi.fn(async (files: readonly File[]) =>
      files.map((file) => ({
        href: `/wiki/attachments/${file.name}`,
        isImage: false,
        name: file.name,
      })),
    );
    const { editor, container } = await ready("\n", {
      features: { uploadFiles },
    });
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["x"], "a.txt");

    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(markdownOf(editor)).toContain("[a.txt](/wiki/attachments/a.txt)"),
    );
    fireEvent.change(input, { target: { files: [] } });

    const paste = new Event("paste", {
      bubbles: true,
      cancelable: true,
    }) as Event & { clipboardData: unknown };

    paste.clipboardData = {
      files: [new File(["y"], "b.txt")],
      getData: () => "",
      types: ["Files"],
    };
    act(() => {
      editor.view.dom.dispatchEvent(paste);
    });
    await waitFor(() => expect(markdownOf(editor)).toContain("b.txt"));

    const drop = new Event("drop", {
      bubbles: true,
      cancelable: true,
    }) as Event & { dataTransfer: unknown; clientX: number; clientY: number };

    drop.dataTransfer = {
      files: [new File(["z"], "c.txt")],
      getData: () => "",
      types: ["Files"],
    };
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
      inside: -1,
      pos: 1,
    });
    act(() => {
      editor.view.dom.dispatchEvent(drop);
    });
    await waitFor(() => expect(uploadFiles).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(markdownOf(editor)).toContain("c.txt"));
    vi.mocked(editor.view.posAtCoords).mockRestore();

    const text = new Event("paste", {
      bubbles: true,
      cancelable: true,
    }) as Event & { clipboardData: unknown };

    text.clipboardData = {
      files: [],
      getData: (type: string) => (type === "text/plain" ? "# Heading" : ""),
      types: ["text/plain"],
    };
    act(() => {
      editor.view.dom.dispatchEvent(text);
    });
    await waitFor(() =>
      expect(markdownOf(editor)).toContain("\n\n# Heading\n"),
    );

    const html = new Event("paste", {
      bubbles: true,
      cancelable: true,
    }) as Event & { clipboardData: unknown };

    html.clipboardData = {
      files: [],
      getData: (type: string) => (type === "text/html" ? "<h3>Html</h3>" : ""),
      types: ["text/html"],
    };
    act(() => {
      editor.view.dom.dispatchEvent(html);
    });
    await waitFor(() => expect(markdownOf(editor)).toContain("Html"));

    key(editor, "V", { ctrlKey: true, shiftKey: true });
    const plain = new Event("paste", {
      bubbles: true,
      cancelable: true,
    }) as Event & { clipboardData: unknown };

    plain.clipboardData = {
      files: [],
      getData: (type: string) => (type === "text/plain" ? "**plain**" : ""),
      types: ["text/plain"],
    };
    act(() => {
      editor.view.dom.dispatchEvent(plain);
    });
    await waitFor(() =>
      expect(markdownOf(editor)).toContain("\\*\\*plain\\*\\*"),
    );
    key(editor, "a");

    const empty = new Event("paste", {
      bubbles: true,
      cancelable: true,
    }) as Event & { clipboardData: unknown };

    empty.clipboardData = { files: [], getData: () => "", types: [] };
    const before = markdownOf(editor);

    act(() => {
      editor.view.dom.dispatchEvent(empty);
    });
    expect(markdownOf(editor)).toBe(before);
  });

  it("does not upload without the feature", async () => {
    const { editor } = await ready("\n");
    const paste = new Event("paste", {
      bubbles: true,
      cancelable: true,
    }) as Event & { clipboardData: unknown };

    paste.clipboardData = {
      files: [new File(["y"], "b.txt")],
      getData: () => "",
      types: ["Files"],
    };
    act(() => {
      editor.view.dom.dispatchEvent(paste);
    });
    expect(markdownOf(editor)).toBe("");
  });
});

describe("selection toolbar", () => {
  it("formats the selection, comments on it and shows the unavailable assistant", async () => {
    const comment = vi.fn();
    const { editor } = await ready("text\n", { features: { comment } });

    act(() => {
      editor.commands.focus();
      editor.commands.setTextSelection({ from: 1, to: 5 });
    });
    const toolbar = await screen.findByRole("toolbar", {
      name: "Formatierung",
    });

    fireEvent.click(within(toolbar).getByRole("button", { name: /^Fett/ }));
    fireEvent.click(within(toolbar).getByRole("button", { name: /^Kursiv/ }));
    fireEvent.click(
      within(toolbar).getByRole("button", { name: /^Durchgestrichen/ }),
    );
    fireEvent.click(within(toolbar).getByRole("button", { name: /^Code/ }));
    expect(markdownOf(editor)).toBe("**_~~`text`~~_**\n");
    fireEvent.click(
      within(toolbar).getByRole("button", { name: "Kommentieren" }),
    );
    expect(comment).toHaveBeenCalled();
    expect(
      within(toolbar).getByRole("button", { name: /noch nicht verfügbar/ }),
    ).toBeDisabled();
    fireEvent.keyDown(within(toolbar).getByRole("button", { name: /^Fett/ }), {
      key: "ArrowRight",
    });
    fireEvent.keyDown(toolbar, { key: "ArrowLeft" });
    fireEvent.keyDown(toolbar, { key: "x" });
    fireEvent.click(within(toolbar).getByRole("button", { name: /^Link/ }));
    expect(
      await screen.findByRole("dialog", { name: "Link" }),
    ).toBeInTheDocument();
  });

  it("offers the assistant once it is connected and shows only for text outside code", async () => {
    const open = vi.fn();
    const { editor } = await ready("text\n\n```\ncode\n```\n", {
      features: { textAssistant: { open } },
    });

    act(() => {
      editor.commands.focus();
      editor.commands.setTextSelection({ from: 1, to: 5 });
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /^Textassistenz/ }),
    );
    expect(open).toHaveBeenCalled();
    expect(shouldShowSelectionToolbar(editor, editor.state)).toBe(true);
    act(() => {
      editor.commands.setTextSelection({ from: 8, to: 10 });
    });
    expect(shouldShowSelectionToolbar(editor, editor.state)).toBe(false);
    act(() => {
      editor.commands.setNodeSelection(0);
    });
    expect(shouldShowSelectionToolbar(editor, editor.state)).toBe(false);
  });
});

describe("mobile toolbar", () => {
  it("appears while the editor has the focus and runs its actions", async () => {
    const { editor } = await ready("item\n");

    expect(screen.queryByRole("toolbar", { name: "Werkzeuge" })).toBeNull();
    act(() => {
      editor.commands.focus("end");
    });
    await screen.findByRole("toolbar", { name: "Werkzeuge" });
    const click = (name: RegExp): void => {
      fireEvent.click(
        within(screen.getByRole("toolbar", { name: "Werkzeuge" })).getByRole(
          "button",
          { name },
        ),
      );
    };

    click(/^Fett/);
    click(/^Kursiv/);
    click(/^Aufzählung/);
    expect(markdownOf(editor)).toBe("- item\n");
    click(/^Einrücken/);
    click(/^Ausrücken/);
    click(/^Aufgabenliste/);
    expect(markdownOf(editor)).toBe("- [ ] item\n");
    click(/^Einrücken/);
    click(/^Ausrücken/);
    click(/^Rückgängig/);
    click(/^Wiederholen/);
    click(/^Link/);
    expect(
      await screen.findByRole("dialog", { name: "Link" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Link" })).toBeNull(),
    );
    act(() => {
      editor.commands.focus("end");
    });
    await screen.findByRole("toolbar", { name: "Werkzeuge" });
    click(/^Block einfügen/);
    expect(
      await screen.findByRole("listbox", { name: "Blöcke" }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(
        await screen.findByRole("toolbar", { name: "Werkzeuge" }),
      ).getByRole("button", { name: /^Emoji einfügen/ }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Emoji einfügen" }),
    ).toBeInTheDocument();
  });

  it("opens the menu from the toolbar and starts the slash menu after a blank", async () => {
    const { editor } = await ready("word\n");

    act(() => {
      editor.commands.focus("end");
    });
    fireEvent.click(
      within(
        await screen.findByRole("toolbar", { name: "Werkzeuge" }),
      ).getByRole("button", { name: /^Editormenü/ }),
    );
    expect(
      await screen.findByRole("menu", { name: "Editormenü" }),
    ).toBeInTheDocument();
    act(() => openSlashMenu(editor));
    expect(editor.state.doc.firstChild?.textContent).toBe("word /");
    act(() => {
      editor.commands.setContent("<p>a </p>");
      editor.commands.focus("end");
      openSlashMenu(editor);
    });
    expect(editor.state.doc.firstChild?.textContent).toBe("a /");
  });
});
