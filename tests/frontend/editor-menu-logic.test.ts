// @vitest-environment jsdom
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  BLOCK_OPTIONS,
  filterBlockOptions,
} from "@/app/components/editor/editor-block-catalog";
import {
  pasteFromClipboard,
  runClipboardCommand,
  writeClipboardText,
} from "@/app/components/editor/editor-clipboard";
import {
  applyBlockOption,
  applyReference,
  insertCreatedPage,
  isBlockOptionAvailable,
} from "@/app/components/editor/editor-menu-extensions";
import { insertUploads } from "@/app/components/editor/editor-uploads";
import { SuggestionStore } from "@/app/components/editor/menus/suggestion-store";
import { serializeMarkdown } from "@/app/lib/editor/editor-markdown";
import {
  formatShortcut,
  isApplePlatform,
} from "@/app/lib/editor/editor-shortcuts";
import {
  EMOJI_CATEGORIES,
  EMOJI_ENTRIES,
  searchEmoji,
} from "@/app/lib/editor/emoji-catalog";
import { normalizeIcon } from "@/backend/service/wiki/WikiValidation";

import { createTestEditor, installEditorGeometry } from "../helpers/editor";

import type { Editor } from "@tiptap/core";
import type { BlockOption } from "@/app/components/editor/editor-block-catalog";

let editors: Editor[] = [];

function open(markdown: string): Editor {
  const editor = createTestEditor(markdown);

  editors.push(editor);

  return editor;
}

const markdownOf = (editor: Editor): string =>
  serializeMarkdown(editor.state.doc, null);
const option = (key: BlockOption["key"]): BlockOption => {
  const found = BLOCK_OPTIONS.find((entry) => entry.key === key);

  if (!found) {
    throw new Error(key);
  }

  return found;
};
const keyEvent = (key: string): KeyboardEvent =>
  new KeyboardEvent("keydown", { key });

beforeAll(installEditorGeometry);

afterEach(() => {
  editors.forEach((editor) => editor.destroy());
  editors = [];
});

describe("suggestion store", () => {
  function shown(): {
    store: SuggestionStore<string>;
    command: ReturnType<typeof vi.fn>;
    listener: ReturnType<typeof vi.fn>;
  } {
    const store = new SuggestionStore<string>((item) => item !== "off");
    const command = vi.fn();
    const listener = vi.fn();

    store.subscribe(listener);
    store.show({
      clientRect: () => new DOMRect(1, 2, 3, 4),
      command,
      items: ["a", "off", "c"],
      query: "x",
      range: { from: 1, to: 2 },
    });

    return { command, listener, store };
  }

  it("moves the highlight with the arrows, wraps around and keeps it for the same query", () => {
    const { store, listener } = shown();

    expect(store.handleKey(keyEvent("ArrowDown"))).toBe(true);
    expect(store.handleKey(keyEvent("ArrowDown"))).toBe(true);
    expect(store.getSnapshot()?.activeIndex).toBe(2);
    expect(store.handleKey(keyEvent("ArrowDown"))).toBe(true);
    expect(store.getSnapshot()?.activeIndex).toBe(0);
    expect(store.handleKey(keyEvent("ArrowUp"))).toBe(true);
    expect(store.getSnapshot()?.activeIndex).toBe(2);
    store.show({
      command: vi.fn(),
      items: ["a", "b", "c"],
      query: "x",
      range: { from: 1, to: 2 },
    });
    expect(store.getSnapshot()?.activeIndex).toBe(2);
    expect(store.getSnapshot()?.rect).toBeNull();
    store.show({
      command: vi.fn(),
      items: ["a"],
      query: "y",
      range: { from: 1, to: 2 },
    });
    expect(store.getSnapshot()?.activeIndex).toBe(0);
    expect(listener).toHaveBeenCalled();
  });

  it("chooses enabled items with Enter, Tab and clicks and refuses disabled ones", () => {
    const { store, command } = shown();

    expect(store.handleKey(keyEvent("Enter"))).toBe(true);
    expect(command).toHaveBeenCalledWith("a");
    store.highlight(1);
    expect(store.handleKey(keyEvent("Tab"))).toBe(false);
    expect(store.pick(9)).toBe(false);
    store.highlight(9);
    expect(store.getSnapshot()?.activeIndex).toBe(1);
  });

  it("closes with Escape and ignores keys while closed", () => {
    const { store } = shown();
    const unsubscribe = store.subscribe(vi.fn());

    expect(store.handleKey(keyEvent("x"))).toBe(false);
    expect(store.handleKey(keyEvent("Escape"))).toBe(true);
    expect(store.getSnapshot()).toBeNull();
    expect(store.handleKey(keyEvent("ArrowDown"))).toBe(false);
    expect(store.pick(0)).toBe(false);
    store.highlight(0);
    unsubscribe();
  });

  it("handles arrows in an empty list", () => {
    const store = new SuggestionStore<string>();

    store.show({
      command: vi.fn(),
      items: [],
      query: "",
      range: { from: 1, to: 1 },
    });
    expect(store.handleKey(keyEvent("ArrowDown"))).toBe(true);
    expect(store.handleKey(keyEvent("ArrowUp"))).toBe(true);
    expect(store.handleKey(keyEvent("Enter"))).toBe(false);

    const command = vi.fn();

    store.show({ command, items: ["x"], query: "", range: { from: 1, to: 1 } });
    expect(store.handleKey(keyEvent("Enter"))).toBe(true);
    expect(command).toHaveBeenCalledWith("x");
    store.hide();
  });
});

describe("catalogs and shortcuts", () => {
  it("filters the slash menu by translated names and search words", () => {
    const labelOf = (entry: BlockOption): string =>
      entry.key === "toggle" ? "Ausklappbereich" : entry.key;

    expect(
      filterBlockOptions(BLOCK_OPTIONS, "ausklapp", labelOf).map(
        (entry) => entry.key,
      ),
    ).toEqual(["toggle"]);
    expect(
      filterBlockOptions(BLOCK_OPTIONS, "  ÜBER  ", labelOf).map(
        (entry) => entry.key,
      ),
    ).toEqual(["heading1", "heading2", "heading3"]);
    expect(filterBlockOptions(BLOCK_OPTIONS, "", labelOf)).toHaveLength(
      BLOCK_OPTIONS.length,
    );
  });

  it("finds emoji by English and German words, every one a valid page icon", () => {
    expect(searchEmoji("rakete")[0]?.emoji).toBe("🚀");
    expect(searchEmoji("rocket launch")[0]?.emoji).toBe("🚀");
    expect(searchEmoji("Glühbirne").map((entry) => entry.emoji)).toContain(
      "💡",
    );
    expect(searchEmoji("", 3)).toHaveLength(3);
    expect(searchEmoji("zzz")).toEqual([]);
    expect(new Set(EMOJI_ENTRIES.map((entry) => entry.category))).toEqual(
      new Set(EMOJI_CATEGORIES),
    );
    EMOJI_ENTRIES.forEach((entry) =>
      expect(normalizeIcon(entry.emoji)).toBe(entry.emoji),
    );
  });

  it("writes shortcuts for Apple and other devices", () => {
    expect(isApplePlatform("MacIntel")).toBe(true);
    expect(isApplePlatform("Linux x86_64")).toBe(false);
    expect(formatShortcut("redo", true)).toBe("⌘⇧Z");
    expect(formatShortcut("redo", false)).toBe("Ctrl+Shift+Z");
    expect(formatShortcut("moveUp", false)).toBe("Ctrl+Shift+↑");
    expect(formatShortcut("contextMenu", true)).toBe("⇧F10");
    expect(formatShortcut("codeBlock", true)).toBe("⌘⌥C");
  });
});

describe("slash menu actions", () => {
  it("offers uploads and subpages only with their features", () => {
    const base = { isDisplayableImage: () => false };

    expect(isBlockOptionAvailable(option("file"), base)).toBe(false);
    expect(isBlockOptionAvailable(option("page"), base)).toBe(false);
    expect(isBlockOptionAvailable(option("assistant"), base)).toBe(true);
    expect(
      isBlockOptionAvailable(option("file"), { ...base, uploadFiles: vi.fn() }),
    ).toBe(true);
    expect(
      isBlockOptionAvailable(option("page"), { ...base, createPage: vi.fn() }),
    ).toBe(true);
  });

  it("replaces the typed command and carries out the entry", () => {
    const requests = { emoji: vi.fn(), files: vi.fn() };
    const open = vi.fn();
    const features = {
      isDisplayableImage: () => false,
      textAssistant: { open },
    };
    const context = { features: () => features, requests: () => requests };
    const editor = createTestEditor("/head\n");

    editors.push(editor);
    applyBlockOption(editor, { from: 1, to: 6 }, option("heading2"), context);
    expect(markdownOf(editor)).toBe("##\n");
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");
    applyBlockOption(editor, { from: 1, to: 1 }, option("file"), context);
    applyBlockOption(editor, { from: 1, to: 1 }, option("emoji"), context);
    applyBlockOption(editor, { from: 1, to: 1 }, option("assistant"), context);
    applyBlockOption(editor, { from: 1, to: 1 }, option("assistant"), {
      ...context,
      features: () => ({ isDisplayableImage: () => false }),
    });
    expect([
      requests.files.mock.calls.length,
      requests.emoji.mock.calls.length,
      open.mock.calls.length,
    ]).toEqual([1, 1, 1]);
  });

  it("links a created subpage and reports cancelled and failed creations", async () => {
    const editor = open("\n");
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const base = { isDisplayableImage: () => false };

    expect(
      await insertCreatedPage(editor, {
        ...base,
        createPage: async () => ({
          href: "/wiki/p1",
          icon: "📘",
          title: "Sub",
        }),
      }),
    ).toBe(true);
    expect(markdownOf(editor)).toBe("[📘 Sub](/wiki/p1)\n");
    expect(
      await insertCreatedPage(editor, {
        ...base,
        createPage: async () => ({
          href: "/wiki/p2",
          icon: null,
          title: "Plain",
        }),
      }),
    ).toBe(true);
    expect(markdownOf(editor)).toContain("[Plain](/wiki/p2)");
    expect(
      await insertCreatedPage(editor, {
        ...base,
        createPage: async () => null,
      }),
    ).toBe(false);
    expect(await insertCreatedPage(editor, base)).toBe(false);
    expect(
      await insertCreatedPage(editor, {
        ...base,
        createPage: () => Promise.reject(new Error("down")),
      }),
    ).toBe(false);
    expect(error).toHaveBeenCalled();

    const gone = open("\n");
    let finish: (link: null) => void = () => undefined;
    const pending = insertCreatedPage(gone, {
      ...base,
      createPage: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });

    gone.destroy();
    finish(null);
    expect(await pending).toBe(false);
  });

  it("does not link a page once the editor is gone", async () => {
    const editor = createTestEditor("\n");
    const result = insertCreatedPage(editor, {
      createPage: async () => {
        editor.destroy();

        return { href: "/wiki/x", icon: null, title: "X" };
      },
      isDisplayableImage: () => false,
    });

    expect(await result).toBe(false);
  });

  it("inserts references as links or text in place of the trigger", () => {
    const editor = open("[[pa\n");

    applyReference(
      editor,
      { from: 1, to: 5 },
      {
        hint: "Seite",
        insertion: { href: "/wiki/p", kind: "link", text: "Page" },
        key: "page:p",
        label: "Page",
      },
    );
    expect(markdownOf(editor)).toBe("[Page](/wiki/p)\n");
    applyReference(
      editor,
      {
        from: editor.state.doc.content.size - 1,
        to: editor.state.doc.content.size - 1,
      },
      {
        hint: "Person",
        insertion: { kind: "text", text: "@olga " },
        key: "person:o",
        label: "Olga",
      },
    );
    expect(markdownOf(editor)).toBe("[Page](/wiki/p) @olga\n");
  });
});

describe("uploads", () => {
  it("inserts images and file links at the selection", async () => {
    const editor = open("text\n");

    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)),
    );
    expect(
      await insertUploads(editor.view, [new File(["x"], "a.png")], async () => [
        { href: "/wiki/attachments/a", isImage: true, name: "a.png" },
        { href: "/wiki/attachments/b", isImage: false, name: "b.pdf" },
      ]),
    ).toBe(true);
    expect(markdownOf(editor)).toBe(
      "text\n\n![a.png](/wiki/attachments/a)\n\n[b.pdf](/wiki/attachments/b)\n",
    );
  });

  it("inserts nothing for no result, a closed editor or a failure", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const editor = open("text\n");

    expect(await insertUploads(editor.view, [], async () => [])).toBe(false);
    expect(
      await insertUploads(editor.view, [], () =>
        Promise.reject(new Error("413")),
      ),
    ).toBe(false);
    expect(error).toHaveBeenCalled();

    const closed = createTestEditor("text\n");

    expect(
      await insertUploads(closed.view, [], async () => {
        closed.destroy();

        return [{ href: "/x", isImage: false, name: "x" }];
      }),
    ).toBe(false);
  });
});

describe("clipboard of the menu", () => {
  it("copies and cuts through the browser command", () => {
    const editor = open("text\n");
    const execCommand = vi.fn(() => true);

    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    expect(runClipboardCommand(editor, "copy")).toBe(true);
    expect(runClipboardCommand(editor, "cut")).toBe(true);
    expect(execCommand.mock.calls).toEqual([["copy"], ["cut"]]);
  });

  function stubClipboard(clipboard: Partial<Clipboard> | undefined): void {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: clipboard,
    });
  }

  it("pastes HTML, markdown and plain text from the clipboard", async () => {
    const editor = open("\n");
    const item = (types: Record<string, string>) => ({
      getType: async (type: string) => new Blob([types[type] ?? ""]),
      types: Object.keys(types),
    });

    stubClipboard({
      read: async () =>
        [item({ "text/html": "<h2>Html</h2>" })] as unknown as ClipboardItems,
      readText: async () => "",
    });
    expect(await pasteFromClipboard(editor, false)).toBe("done");
    expect(markdownOf(editor)).toContain("## Html");
    editor.commands.clearContent();
    stubClipboard({
      read: async () =>
        [item({ "text/plain": "- md" })] as unknown as ClipboardItems,
      readText: async () => "",
    });
    expect(await pasteFromClipboard(editor, false)).toBe("done");
    expect(markdownOf(editor)).toBe("- md\n");
    editor.commands.clearContent();
    stubClipboard({
      read: async () =>
        [item({ "image/png": "x" })] as unknown as ClipboardItems,
      readText: async () => "",
    });
    expect(await pasteFromClipboard(editor, false)).toBe("done");
    stubClipboard({ readText: async () => "**plain**" });
    expect(await pasteFromClipboard(editor, false)).toBe("done");
    expect(await pasteFromClipboard(editor, true)).toBe("done");
    expect(markdownOf(editor)).toContain("\\*\\*plain\\*\\*");
  });

  it("reports a missing or refused clipboard instead of pretending", async () => {
    const editor = open("\n");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    stubClipboard(undefined);
    expect(await pasteFromClipboard(editor, false)).toBe("unavailable");
    expect(await writeClipboardText("x")).toBe(false);
    stubClipboard({});
    expect(await pasteFromClipboard(editor, true)).toBe("unavailable");
    stubClipboard({ readText: () => Promise.reject(new Error("denied")) });
    expect(await pasteFromClipboard(editor, true)).toBe("denied");
    stubClipboard({ writeText: async () => undefined });
    expect(await writeClipboardText("x")).toBe(true);
    expect(warn).toHaveBeenCalled();
  });
});
