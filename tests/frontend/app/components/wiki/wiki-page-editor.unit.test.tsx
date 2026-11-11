import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { WikiPageEditor } from "@/app/components/wiki/wiki-page-editor";
import { createI18n } from "@/app/lib/i18n";

import type { WikiPage } from "@/definition/Wiki";

const actions = vi.hoisted(() => ({
  setDraft: vi.fn(),
  saveNow: vi.fn(),
  keepMine: vi.fn(),
  takeTheirs: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
  useRevalidator: () => ({ revalidate: vi.fn() }),
}));
vi.mock("@/app/components/wiki/use-wiki-draft", () => ({
  useWikiDraft: (page: WikiPage) => ({
    draft: { title: page.title, content: "My draft", icon: "" },
    saved: page,
    status: "error",
    errorCode: "network",
    setDraft: actions.setDraft,
    saveNow: actions.saveNow,
    conflict: {
      theirs: { ...page, content: "Their text" },
      keepMine: actions.keepMine,
      takeTheirs: actions.takeTheirs,
    },
    adopt: () => false,
    recover: async () => null,
  }),
}));
vi.mock("@/app/components/wiki/use-wiki-uploads", () => ({
  useWikiUploads: () => ({}),
}));
vi.mock("@/app/components/wiki/use-wiki-editor-features", () => ({
  useWikiEditorFeatures: () => ({}),
}));
vi.mock("@/app/components/wiki/wiki-editor-uploads", () => ({
  UploadStatus: () => null,
}));
vi.mock("@/app/components/wiki/wiki-page-hero", () => ({
  WikiPageHero: () => null,
}));
vi.mock("@/app/components/editor/block-editor", () => ({
  BlockEditor: ({
    onChange,
    onReady,
  }: {
    onChange: (content: string) => void;
    onReady: (handle: {
      element: HTMLElement;
      replaceMarkdown: typeof actions.replace;
    }) => void;
  }) => (
    <button
      onClick={() => {
        onReady({ element: document.body, replaceMarkdown: actions.replace });
        onChange("Changed");
      }}
    >
      Edit text
    </button>
  ),
}));
vi.mock("@/app/components/wiki/wiki-conflict-dialog", () => ({
  WikiConflictDialog: ({
    mine,
    theirs,
    onTakeTheirs,
  }: {
    mine: string;
    theirs: string;
    onTakeTheirs: () => void;
  }) => (
    <div>
      <p>
        {mine} / {theirs}
      </p>
      <button onClick={onTakeTheirs}>Take theirs</button>
    </div>
  ),
}));

const page: WikiPage = {
  id: "page",
  title: "Page",
  icon: null,
  scope: "instance",
  projectId: null,
  projectName: null,
  parentId: null,
  ownerId: "u",
  ownerName: "User",
  currentUntil: null,
  updatedAt: "2026-01-01",
  createdAt: "2026-01-01",
  content: "Original",
  cover: null,
  revision: 1,
  isTemplate: false,
  updatedByName: null,
  breadcrumb: [],
  anchors: [],
};

it("reports edits, retries a failed save and applies the conflicting version", () => {
  const i18n = createI18n("en");
  const onTextChange = vi.fn();
  const onTextElement = vi.fn();
  const onSaved = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <WikiPageEditor
        page={page}
        attachments={[]}
        meta={null}
        onTextChange={onTextChange}
        onTextElement={onTextElement}
        onComment={vi.fn()}
        onSaved={onSaved}
      />
    </I18nextProvider>,
  );
  expect(onSaved).toHaveBeenCalledWith(page);
  expect(screen.getByText("My draft / Their text")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Edit text" }));
  expect(actions.setDraft).toHaveBeenCalledWith({
    title: "Page",
    content: "Changed",
    icon: "",
  });
  expect(onTextElement).toHaveBeenCalledWith(document.body);
  expect(onTextChange).toHaveBeenCalledOnce();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("backgroundSave.retry") }),
  );
  expect(actions.saveNow).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Take theirs" }));
  expect(actions.replace).toHaveBeenCalledWith("Their text");
  expect(actions.takeTheirs).toHaveBeenCalledOnce();
});
