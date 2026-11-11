import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

import { WikiPageScreen } from "@/app/components/wiki/wiki-page-screen";
import { createI18n } from "@/app/lib/i18n";

import type { WikiPage } from "@/definition/Wiki";

vi.mock("@/app/components/wiki/use-comment-highlights", () => ({
  useCommentHighlights: vi.fn(),
}));
vi.mock("@/app/components/wiki/use-wiki-selection", () => ({
  useWikiSelection: () => null,
}));
vi.mock("@/app/components/wiki/wiki-page-editor", () => ({
  WikiPageEditor: ({
    page,
    onSaved,
  }: {
    page: WikiPage;
    onSaved: (page: WikiPage) => void;
  }) => (
    <button
      onClick={() => onSaved({ ...page, revision: 2, title: "Saved title" })}
    >
      Save draft
    </button>
  ),
}));
vi.mock("@/app/components/wiki/wiki-page-header", () => ({
  WikiBreadcrumb: ({ page }: { page: WikiPage }) => <span>{page.title}</span>,
  WikiPageMeta: () => null,
}));
vi.mock("@/app/components/wiki/wiki-page-menu", () => ({
  WikiPageMenu: () => null,
}));
vi.mock("@/app/components/wiki/wiki-page-hero", () => ({
  WikiPageHero: ({ page }: { page: WikiPage }) => <h1>{page.title}</h1>,
}));
vi.mock("@/app/components/wiki/wiki-markdown", () => ({
  WikiMarkdown: ({ source }: { source: string }) => <p>{source}</p>,
}));
vi.mock("@/app/components/wiki/wiki-attachments-view", () => ({
  WikiAttachmentsView: () => null,
}));
vi.mock("@/app/components/wiki/wiki-backlinks-view", () => ({
  WikiBacklinksView: () => null,
}));
vi.mock("@/app/components/wiki/wiki-comments-panel", () => ({
  WikiCommentsPanel: () => null,
}));
vi.mock("@/app/components/wiki/wiki-new-page-dialog", () => ({
  WikiNewPageButton: () => <button>New child</button>,
}));

const page: WikiPage = {
  id: "page",
  title: "Original",
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
  content: "Read this",
  cover: null,
  revision: 1,
  isTemplate: false,
  updatedByName: null,
  breadcrumb: [],
  anchors: [],
};
const props = {
  view: {
    page,
    permissions: { canEdit: true, canManage: true, canComment: true },
    isFavorite: false,
    children: [{ id: "child", title: "Child", icon: "📄" }],
  },
  navigation: {
    nodes: [],
    projects: [],
    favoriteIds: [],
    expandedIds: [],
    recent: [],
    canCreate: true,
  },
  templates: [],
  versions: [],
  owners: [],
  anchorChoices: { departments: [], milestones: [], epics: [], selected: [] },
  backlinks: { pages: [], tickets: [], projects: [] },
  attachments: [],
  comments: [],
  today: "2026-01-01",
};

it("shows saved page state and links its children", () => {
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <MemoryRouter>
        <WikiPageScreen {...props} />
      </MemoryRouter>
    </I18nextProvider>,
  );
  expect(
    screen.getByRole("link", { name: "📄 Child" }).getAttribute("href"),
  ).toContain("/wiki/child");
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  expect(screen.getByText("Saved title")).toBeTruthy();
});

it("shows page text without editing controls to readers", () => {
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <MemoryRouter>
        <WikiPageScreen
          {...props}
          view={{
            ...props.view,
            permissions: {
              canEdit: false,
              canManage: false,
              canComment: false,
            },
            children: [],
          }}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );
  expect(screen.getByText("Read this")).toBeTruthy();
  expect(screen.queryByText("Save draft")).toBeNull();
  expect(screen.queryByText("New child")).toBeNull();
});
