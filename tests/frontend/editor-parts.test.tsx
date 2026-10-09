// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { GapCursor } from "@tiptap/pm/gapcursor";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { BlockEditor } from "@/app/components/editor/block-editor";
import { EmojiPicker } from "@/app/components/editor/emoji-picker";
import { openSlashMenu } from "@/app/components/editor/editor-mobile-toolbar";
import { FloatingPanel } from "@/app/components/editor/menus/floating-panel";
import { SuggestionMenu } from "@/app/components/editor/menus/suggestion-menu";
import { SuggestionStore } from "@/app/components/editor/menus/suggestion-store";
import { useEditorNotice } from "@/app/components/editor/use-editor-notice";
import { useKeyboardInset } from "@/app/components/editor/use-keyboard-inset";
import {
  handleEditorPaste,
  isPlainPasteKey,
} from "@/app/components/editor/use-block-editor";
import { createI18n } from "@/app/lib/i18n";
import { serializeMarkdown } from "@/app/lib/editor/editor-markdown";
import { LANGUAGE } from "@/language/Language";

import { installEditorGeometry, renderBlockEditor } from "../helpers/editor";

import type { Editor } from "@tiptap/core";

beforeAll(installEditorGeometry);

afterEach(() => {
  vi.useRealTimers();
});

function withI18n(element: React.ReactElement): React.ReactElement {
  return createElement(
    I18nextProvider,
    { i18n: createI18n(LANGUAGE.GERMAN) },
    element,
  );
}

async function ready(
  markdown: string,
  options: Parameters<typeof renderBlockEditor>[1] = {},
) {
  const rendered = renderBlockEditor(markdown, options);

  await waitFor(() => expect(rendered.onReady).toHaveBeenCalled());

  const { editor } = rendered.handle().element as unknown as { editor: Editor };

  return { ...rendered, editor };
}

describe("floating panel", () => {
  it("closes on Escape and on a press outside, but not inside", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <FloatingPanel
        anchor={new DOMRect(1, 2, 3, 4)}
        label="Panel"
        onClose={onClose}
      >
        <button type="button">inside</button>
      </FloatingPanel>,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "inside" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Panel" }), {
      key: "a",
    });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Panel" }), {
      key: "Escape",
    });
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
    rerender(
      <FloatingPanel anchor={null} label="Panel" onClose={onClose}>
        <span>gone</span>
      </FloatingPanel>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("emoji picker", () => {
  it("searches, moves through the grid with the arrows and removes the choice", () => {
    const onPick = vi.fn();
    const onRemove = vi.fn();

    render(withI18n(<EmojiPicker onPick={onPick} onRemove={onRemove} />));
    expect(screen.getByRole("region", { name: "Smileys" })).toBeInTheDocument();

    const first = screen.getByRole("button", { name: "😀" });
    const grid = first.parentElement as HTMLElement;

    first.focus();
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(document.activeElement).toHaveAccessibleName("😃");
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    expect(document.activeElement).toHaveAccessibleName("😀");
    fireEvent.keyDown(grid, { key: "a" });
    screen.getByLabelText("Emoji suchen").focus();
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByLabelText("Emoji suchen"));
    fireEvent.click(first);
    expect(onPick).toHaveBeenCalledWith("😀");
    fireEvent.click(screen.getByRole("button", { name: "Entfernen" }));
    expect(onRemove).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Emoji suchen"), {
      target: { value: "herz" },
    });
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.getByRole("button", { name: "❤️" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Emoji suchen"), {
      target: { value: "xyzxyz" },
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Kein Emoji gefunden.",
    );
  });
});

describe("editor hooks", () => {
  it("hides a notice after a few seconds", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useEditorNotice());

    act(() => result.current.show("Hallo"));
    expect(result.current.message).toBe("Hallo");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.message).toBeNull();
  });

  it("measures the on-screen keyboard and stays at zero without the viewport API", () => {
    const listeners = new Map<string, () => void>();
    const viewport = {
      addEventListener: (name: string, listener: () => void) =>
        listeners.set(name, listener),
      height: 500,
      offsetTop: 0,
      removeEventListener: vi.fn(),
    };

    vi.stubGlobal("visualViewport", viewport);
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    const { result, unmount } = renderHook(() => useKeyboardInset());

    expect(result.current).toBe(300);
    viewport.height = 900;
    act(() => listeners.get("resize")?.());
    expect(result.current).toBe(0);
    unmount();
    expect(viewport.removeEventListener).toHaveBeenCalledTimes(2);
    vi.stubGlobal("visualViewport", undefined);
    expect(renderHook(() => useKeyboardInset()).result.current).toBe(0);
  });

  it("renders no suggestion menu on the server", () => {
    const store = new SuggestionStore<string>();
    const html = renderToString(
      createElement(SuggestionMenu<string>, {
        editor: {} as Editor,
        emptyLabel: "none",
        getKey: (item) => item,
        id: "menu",
        label: "Menu",
        renderItem: (item) => item,
        store,
      }),
    );

    expect(html).toBe("");
  });
});

describe("editor edge cases", () => {
  it("works without onReady and keeps the selection when a toolbar button is pressed", async () => {
    render(
      withI18n(
        <BlockEditor
          fallback={null}
          features={{ isDisplayableImage: () => false }}
          isEditable
          label="Ohne"
          markdown="text"
        />,
      ),
    );
    const element = await screen.findByRole("textbox", { name: "Ohne" });
    const { editor } = element as unknown as { editor: Editor };

    act(() => {
      editor.commands.focus();
      editor.commands.setTextSelection({ from: 1, to: 3 });
    });
    const button = within(
      await screen.findByRole("toolbar", { name: "Formatierung" }),
    ).getByRole("button", { name: /^Fett/ });
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });

    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("drags from the grip, falls back for unknown callout kinds and closes the emoji panel", async () => {
    const { editor, container } = await ready("one\n\ntwo\n");
    const wrapper = container.querySelector(".relative") as HTMLElement;

    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ inside: 0, pos: 1 });
    fireEvent.mouseMove(wrapper, { clientX: 5, clientY: 30 });
    fireEvent.dragStart(
      await screen.findByRole("button", { name: "Blockaktionen" }),
      {
        dataTransfer: {
          effectAllowed: "",
          setData: vi.fn(),
          setDragImage: vi.fn(),
        },
      },
    );
    expect(editor.view.dragging?.move).toBe(true);

    act(() => {
      editor.commands.setContent({
        content: [
          {
            attrs: { kind: "bogus" },
            content: [{ type: "paragraph" }],
            type: "callout",
          },
        ],
        type: "doc",
      });
    });
    expect(
      await screen.findByRole("button", { name: "Art des Hinweises: Notiz" }),
    ).toBeInTheDocument();

    act(() => {
      editor.commands.focus("end");
      openSlashMenu(editor);
    });
    expect(editor.state.doc.lastChild?.textContent).toBe("/");
    fireEvent.keyDown(editor.view.dom, { key: "Escape" });
    act(() => {
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ContextMenu",
        }),
      );
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Emoji einfügen/ }),
    );
    fireEvent.keyDown(
      await screen.findByRole("dialog", { name: "Emoji einfügen" }),
      { key: "Escape" },
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Emoji einfügen" }),
      ).toBeNull(),
    );
  });

  it("changes nothing from the block menu when the caret is behind the last block", async () => {
    for (const name of [/Link zum Block kopieren/, /^Duplizieren/]) {
      const { editor, unmount } = await ready("one\n\n---\n");

      act(() => {
        editor.view.dispatch(
          editor.state.tr.setSelection(
            new GapCursor(
              editor.state.doc.resolve(editor.state.doc.content.size),
            ),
          ),
        );
        editor.view.dom.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "ContextMenu",
          }),
        );
      });
      fireEvent.keyDown(
        await screen.findByRole("menuitem", { name: "Block" }),
        { key: "ArrowRight" },
      );
      fireEvent.click(await screen.findByRole("menuitem", { name }));
      expect(serializeMarkdown(editor.state.doc, null)).toBe("one\n\n---\n");
      unmount();
    }
  });
});

describe("paste and drop details", () => {
  it("pastes plain text even when HTML comes along and ignores events without data", async () => {
    const { editor } = await ready("\n");
    const features = { isDisplayableImage: () => false };
    const plain = {
      clipboardData: {
        files: [],
        getData: (type: string) =>
          type === "text/plain" ? "**x**" : "<b>x</b>",
      },
    } as unknown as ClipboardEvent;

    expect(
      handleEditorPaste(editor.view, plain, { features, isPlain: true }),
    ).toBe(true);
    expect(serializeMarkdown(editor.state.doc, null)).toBe("\\*\\*x\\*\\*\n");
    expect(
      handleEditorPaste(editor.view, plain, { features, isPlain: false }),
    ).toBe(false);
    expect(
      handleEditorPaste(editor.view, {} as ClipboardEvent, {
        features,
        isPlain: false,
      }),
    ).toBe(false);
    expect(
      isPlainPasteKey(
        new KeyboardEvent("keydown", {
          key: "V",
          metaKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe(true);
    expect(
      isPlainPasteKey(
        new KeyboardEvent("keydown", { ctrlKey: true, key: "v" }),
      ),
    ).toBe(false);
  });

  it("reads dropped text as markdown and leaves moved content to ProseMirror", async () => {
    const { editor } = await ready("- [x] done\n", {
      features: { uploadFiles: vi.fn() },
    });
    const copied = editor.view.someProp("clipboardTextSerializer", (write) =>
      write(
        editor.state.doc.slice(0, editor.state.doc.content.size),
        editor.view,
      ),
    );
    const noData = editor.view.someProp("handleDrop", (drop) =>
      drop(editor.view, {} as DragEvent, editor.state.doc.slice(0, 0), false),
    );

    expect(copied).toBe("- [x] done");
    expect(noData).toBeFalsy();
    expect(screen.getByLabelText("Erledigt")).toBeInTheDocument();
    const slice = editor.view.someProp("clipboardTextParser", (parse) =>
      parse("# Dropped", editor.state.doc.resolve(1), false, editor.view),
    );
    const isHandled = editor.view.someProp("handleDrop", (drop) =>
      drop(
        editor.view,
        {
          dataTransfer: { files: [new File(["x"], "x")] },
        } as unknown as DragEvent,
        slice as never,
        true,
      ),
    );

    expect(slice?.content.firstChild?.type.name).toBe("heading");
    expect(isHandled).toBeFalsy();
  });

  it("asks the connected assistant from the slash menu and reads empty file choices", async () => {
    const open = vi.fn();
    const { editor, container } = await ready("\n", {
      features: { textAssistant: { open } },
    });

    act(() => {
      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText("/assistent"));
    });
    fireEvent.click(
      await screen.findByRole("option", { name: /Textassistenz/ }),
    );
    expect(open).toHaveBeenCalled();
    fireEvent.change(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      { target: { files: null } },
    );
  });

  it("marks a selected image and shows images without address as hidden", async () => {
    const { editor } = await ready("![a]() ![b](/wiki/attachments/b)\n", {
      features: { isDisplayableImage: (src) => src !== "" },
    });

    expect(
      await screen.findByText("Bild wird nicht angezeigt: a"),
    ).toBeInTheDocument();
    act(() => {
      editor.commands.setNodeSelection(3);
    });
    await waitFor(() =>
      expect(document.querySelector(".ring-primary img")).not.toBeNull(),
    );
  });
});
