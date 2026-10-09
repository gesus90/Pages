// @vitest-environment jsdom
import { undoDepth } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import DescriptionEditor from "@/app/components/tasks/description/description-editor";
import { createI18n } from "@/app/lib/i18n";

import {
  applyAssistantText,
  captureAssistantTarget,
} from "@/app/lib/editor/editor-assistant";
import {
  createBaseline,
  readMarkdown,
  serializeMarkdown,
} from "@/app/lib/editor/editor-markdown";
import {
  createTestEditor,
  installEditorGeometry,
  renderBlockEditor,
  typeText,
} from "../helpers/editor";
import type { Editor } from "@tiptap/core";

const editors: Editor[] = [];
function open(markdown: string): Editor {
  const editor = createTestEditor(markdown);
  editors.push(editor);
  return editor;
}
beforeAll(installEditorGeometry);
afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
});

describe("assistant edits use existing Markdown and history", () => {
  it("captures the selected passage and replaces it as exactly one separate undo step", () => {
    const editor = open("Hello world\n");
    typeText(editor, "!");
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 8, 13),
      ),
    );
    const target = captureAssistantTarget(editor, null);
    expect(target.selectionMarkdown).toBe("world");
    const before = undoDepth(editor.state);
    expect(
      applyAssistantText(editor, null, {
        target,
        text: "**Welt**",
        scope: "selection",
        kind: "replace",
        maximumLength: 1000,
      }),
    ).toBe(true);
    expect(serializeMarkdown(editor.state.doc, null)).toBe("!Hello **Welt**\n");
    expect(undoDepth(editor.state)).toBe(before + 1);
    typeText(editor, "?");
    editor.commands.undo();
    expect(serializeMarkdown(editor.state.doc, null)).toBe("!Hello **Welt**\n");
    editor.commands.undo();
    expect(serializeMarkdown(editor.state.doc, null)).toBe(
      target.documentMarkdown,
    );
    editor.commands.undo();
    expect(serializeMarkdown(editor.state.doc, null)).toBe("Hello world\n");
  });

  it("replaces a document, inserts at a captured caret, and rejects readonly/stale/oversize edits", () => {
    const editor = open("Old\n");
    const target = captureAssistantTarget(editor, null);
    expect(
      applyAssistantText(editor, null, {
        target,
        text: "## New\n\nText",
        scope: "document",
        kind: "replace",
        maximumLength: 1000,
      }),
    ).toBe(true);
    expect(serializeMarkdown(editor.state.doc, null)).toBe("## New\n\nText\n");
    editor.commands.undo();
    expect(
      applyAssistantText(editor, null, {
        target,
        text: "Added ",
        scope: "none",
        kind: "insert",
        maximumLength: 1000,
      }),
    ).toBe(true);
    expect(serializeMarkdown(editor.state.doc, null)).toContain("AddedOld");
    expect(
      applyAssistantText(editor, null, {
        target,
        text: "stale",
        scope: "document",
        kind: "replace",
        maximumLength: 1000,
      }),
    ).toBe(false);
    editor.commands.undo();
    editor.setEditable(false);
    expect(
      applyAssistantText(editor, null, {
        target,
        text: "denied",
        scope: "selection",
        kind: "replace",
        maximumLength: 1000,
      }),
    ).toBe(false);
    editor.setEditable(true);
    expect(
      applyAssistantText(editor, null, {
        target,
        text: "😀😀",
        scope: "document",
        kind: "replace",
        maximumLength: 2,
      }),
    ).toBe(false);
    expect(serializeMarkdown(editor.state.doc, null)).toBe("Old\n");
    expect(
      applyAssistantText(editor, null, {
        target,
        text: "😀😀",
        scope: "document",
        kind: "replace",
        maximumLength: 3,
        lengthUnit: "codeUnit",
      }),
    ).toBe(false);
    expect(
      applyAssistantText(editor, null, {
        target,
        text: "😀😀",
        scope: "document",
        kind: "replace",
        maximumLength: 3,
      }),
    ).toBe(true);
  });

  it("exposes capture/apply on the real React editor handle", async () => {
    const rendered = renderBlockEditor("Text\n");
    await waitFor(() => expect(rendered.onReady).toHaveBeenCalled());
    const handle = rendered.handle();
    const target = handle.captureAssistantTarget?.();
    expect(target?.documentMarkdown).toBe("Text\n");
    if (!target) throw new Error("Missing capture contract");
    expect(
      handle.applyAssistantText?.({
        target,
        text: "New",
        scope: "document",
        kind: "replace",
        maximumLength: 100,
      }),
    ).toBe(true);
    expect(handle.getMarkdown()).toBe("New\n");
    const editor = open("baseline\n");
    const baseline = createBaseline(
      readMarkdown("baseline\n", editor.schema),
      editor.state.doc,
    );
    expect(captureAssistantTarget(editor, baseline).documentMarkdown).toBe(
      "baseline\n",
    );
  });
});

it("supports the description editor's existing optional assistant API", async () => {
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <MemoryRouter>
        <DescriptionEditor
          label="Description"
          variant="panel"
          features={{ isDisplayableImage: () => false }}
          state={{
            status: "editing",
            isEditing: true,
            draft: "Text",
            base: "Text",
            isDirty: false,
            errorCode: "",
            change: vi.fn(),
            save: vi.fn(),
            cancel: vi.fn(),
            takeLatest: () => "Text",
            startEditing: vi.fn(),
          }}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );
  expect(
    await screen.findByRole("textbox", { name: "Description" }),
  ).toHaveTextContent("Text");
});
