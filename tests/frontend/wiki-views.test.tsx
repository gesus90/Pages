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
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import { RegionProvider } from "@/app/components/common/region-provider";
import { WikiHomeView } from "@/app/components/wiki/wiki-home-view";
import {
  WikiBreadcrumb,
  WikiPageMeta,
} from "@/app/components/wiki/wiki-page-header";
import { WIKI_SEARCH_EVENT, WikiShell } from "@/app/components/wiki/wiki-shell";
import { WikiPageScreen } from "@/app/components/wiki/wiki-page-screen";
import { WikiTrashView } from "@/app/components/wiki/wiki-trash-view";
import { createI18n } from "@/app/lib/i18n";
import WikiRoute from "@/app/routes/wiki";
import WikiHomeRoute from "@/app/routes/wiki-home";
import WikiPageRoute from "@/app/routes/wiki-page";
import WikiTrashRoute from "@/app/routes/wiki-trash";
import { LANGUAGE } from "@/language/Language";

import { installEditorGeometry, typeText } from "../helpers/editor";
import { renderInWiki } from "../helpers/wiki-render";

import type { Editor } from "@tiptap/core";

import type {
  WikiNavigation,
  WikiPage,
  WikiPageSummary,
  WikiPageView,
} from "@/definition/Wiki";

const PAGE: WikiPage = {
  anchors: [],
  breadcrumb: [],
  content: "# Heading\n\nBody text",
  cover: null,
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
  updatedByName: "Max",
};

const NAVIGATION: WikiNavigation = {
  canCreate: true,
  expandedIds: [],
  favoriteIds: [],
  nodes: [
    {
      currentUntil: null,
      icon: null,
      id: "p1",
      parentId: null,
      position: 1,
      projectId: null,
      scope: "instance",
      title: "Guide",
    },
  ],
  projects: [{ id: "pr1", name: "Project One" }],
  recent: [],
};

function view(
  overrides: Partial<WikiPageView> = {},
  page: Partial<WikiPage> = {},
): WikiPageView {
  return {
    children: [],
    isFavorite: false,
    page: { ...PAGE, ...page },
    permissions: { canComment: true, canEdit: true, canManage: true },
    ...overrides,
  };
}

function screenElement(pageView: WikiPageView): React.ReactElement {
  return (
    <WikiPageScreen
      anchorChoices={{
        departments: [],
        epics: [],
        milestones: [],
        selected: [],
      }}
      navigation={NAVIGATION}
      owners={[{ displayName: "Olga", id: "o1" }]}
      templates={[]}
      today="2026-10-07"
      attachments={[]}
      comments={[]}
      backlinks={{ pages: [], projects: [], tickets: [] }}
      versions={[]}
      view={pageView}
    />
  );
}

function screenOf(
  pageView: WikiPageView,
  options: Parameters<typeof renderInWiki>[1] = {},
) {
  return renderInWiki(screenElement(pageView), {
    path: "/wiki/p1",
    ...options,
  });
}

function summary(
  id: string,
  overrides: Partial<WikiPageSummary> = {},
): WikiPageSummary {
  return {
    createdAt: "2026-01-01 10:00:00",
    currentUntil: null,
    icon: null,
    id,
    ownerId: "o1",
    ownerName: "Olga",
    parentId: null,
    projectId: null,
    projectName: null,
    scope: "instance",
    title: `Page ${id}`,
    updatedAt: "2026-01-02 10:00:00",
    ...overrides,
  };
}

beforeAll(installEditorGeometry);

async function editorOf(): Promise<Editor> {
  const element = await screen.findByRole("textbox", { name: "Page text" });

  return (element as unknown as { editor: Editor }).editor;
}

describe("WikiBreadcrumb and WikiPageMeta", () => {
  function renderHeader(page: Partial<WikiPage>) {
    const full = { ...PAGE, ...page };

    return renderInWiki(
      <>
        <WikiBreadcrumb page={full} />
        <WikiPageMeta page={full} today="2026-10-07" />
      </>,
      { path: "/wiki/p1" },
    );
  }

  it("shows the pages above, the page itself, the owner and the last editor", async () => {
    renderHeader({
      breadcrumb: [
        { icon: "🗂️", id: "a", title: "Top" },
        { icon: null, id: "b", title: "Middle" },
      ],
    });

    expect(await screen.findByRole("link", { name: "🗂️ Top" })).toHaveAttribute(
      "href",
      "/wiki/a/top",
    );
    expect(screen.getByRole("link", { name: "Middle" })).toBeVisible();
    expect(screen.getByText("📘 Guide")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText(/Owner: Olga/)).toHaveTextContent(
      "Last edited by Max on 2026-01-02",
    );
  });

  it("names the owner when nobody edited and shows a page without icon", async () => {
    renderHeader({ icon: null, updatedByName: null });

    expect(await screen.findByText(/Last edited by Olga/)).toBeVisible();
    expect(
      within(screen.getByRole("navigation", { name: "Page path" })).getByText(
        "Guide",
      ),
    ).toBeVisible();
  });

  it("marks private pages, projects, the review date and anchors", async () => {
    renderHeader({
      anchors: [
        { kind: "department", label: "Sales", targetId: "d" },
        { kind: "epic", label: null, targetId: "e" },
      ],
      currentUntil: "2026-12-31",
      projectName: "Project One",
      scope: "private",
    });

    expect(await screen.findByText("Private")).toBeVisible();
    expect(screen.getByText("Project One")).toBeVisible();
    expect(screen.getByText("Current until 2026-12-31")).toBeVisible();
    expect(screen.getByText("Department: Sales")).toBeVisible();
    expect(screen.getByText("Epic: no longer exists")).toBeVisible();
  });

  it("shows an expired review date as such", async () => {
    renderHeader({ currentUntil: "2026-01-01" });

    expect(await screen.findByText("Expired on 2026-01-01")).toBeVisible();
  });
});

describe("WikiPageScreen", () => {
  it("renders the text, the subpages and the menu for a manager", async () => {
    screenOf(
      view({
        children: [
          { icon: "📄", id: "c1", title: "Child" },
          { icon: null, id: "c2", title: "Plain child" },
        ],
      }),
    );

    expect(
      await screen.findByRole("heading", { name: "Heading" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "📄 Child" })).toHaveAttribute(
      "href",
      "/wiki/c1/child",
    );
    expect(screen.getByRole("button", { name: "New subpage" })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Page menu" }));

    expect(
      (await screen.findAllByRole("menuitem")).map((item) => item.textContent),
    ).toEqual([
      "History",
      "Move to…",
      "Duplicate",
      "Save as template",
      "Links",
      "Current until…",
      "Change owner",
      "Move to trash",
    ]);
  });

  it("limits the menu for readers and for private pages", async () => {
    const { unmount } = screenOf(
      view({
        permissions: { canComment: true, canEdit: false, canManage: false },
      }),
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Page menu" }),
    );

    expect(
      (await screen.findAllByRole("menuitem")).map((item) => item.textContent),
    ).toEqual(["History"]);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New subpage" })).toBeNull();
    expect(screen.getByText("No subpages.")).toBeVisible();

    unmount();
    screenOf(view({}, { scope: "private" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Page menu" }),
    );

    const items = (await screen.findAllByRole("menuitem")).map(
      (item) => item.textContent,
    );

    expect(items).not.toContain("Links");
    expect(items).not.toContain("Change owner");
  });

  it.each([
    ["History", "Page history"],
    ["Move to…", "Move page"],
    ["Duplicate", "Duplicate page"],
    ["Save as template", "Save as template"],
    ["Links", "Links"],
    ["Current until…", "Current until"],
    ["Change owner", "Change owner"],
    ["Move to trash", "Delete “Guide”?"],
  ])("opens the dialog for %s", async (item, title) => {
    screenOf(view());

    await userEvent.click(
      await screen.findByRole("button", { name: "Page menu" }),
    );
    await userEvent.click(await screen.findByRole("menuitem", { name: item }));

    expect(await screen.findByRole("dialog", { name: title })).toBeVisible();
  });

  it("closes a dialog again", async () => {
    screenOf(view());

    await userEvent.click(
      await screen.findByRole("button", { name: "Page menu" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Duplicate" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Cancel" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("edits title and text in place and shows the read view to readers", async () => {
    const { unmount } = screenOf(view());

    expect(
      await screen.findByRole("textbox", { name: "Page title" }),
    ).toHaveValue("Guide");
    expect(
      within(
        await screen.findByRole("textbox", { name: "Page text" }),
      ).getByRole("heading", { name: "Heading" }),
    ).toBeVisible();
    unmount();
    screenOf(
      view({
        permissions: { canComment: true, canEdit: false, canManage: false },
      }),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Guide" }),
    ).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Page text" })).toBeNull();
  });

  describe("after the editor saved", () => {
    const SAVED = "# Heading\n\nBody text!";
    let setLoaded: (loaded: WikiPageView) => void = () => undefined;

    function Harness(): React.ReactElement {
      const [loaded, setLoadedState] = useState(view());

      setLoaded = setLoadedState;

      return <div key={loaded.page.id}>{screenElement(loaded)}</div>;
    }

    async function saveOnce(): Promise<ReturnType<typeof renderInWiki>> {
      const rendered = renderInWiki(<Harness />, {
        pageAnswers: {
          save: { ok: true, page: { ...PAGE, content: SAVED, revision: 2 } },
        },
        path: "/wiki/p1",
      });
      const editor = await editorOf();

      act(() => {
        editor.commands.focus("end");
        typeText(editor, "!");
      });
      await waitFor(() => expect(rendered.pageSubmissions).toHaveLength(1), {
        timeout: 4000,
      });
      expect(rendered.pageSubmissions[0]).toMatchObject({
        content: SAVED,
        expectedRevision: "1",
        intent: "save",
      });
      expect(await screen.findByText("Saved")).toBeVisible();

      return rendered;
    }

    it("saves on from the saved revision, not from the stale loader data", async () => {
      const { pageSubmissions } = await saveOnce();
      const editor = await editorOf();

      act(() => {
        editor.commands.focus("end");
        typeText(editor, "?");
      });
      await waitFor(() => expect(pageSubmissions).toHaveLength(2), {
        timeout: 4000,
      });

      expect(pageSubmissions[1]).toMatchObject({ expectedRevision: "2" });
    });

    it("loads newer saved versions into the editor and starts other pages afresh", async () => {
      await saveOnce();
      act(() => setLoaded(view({}, { content: "Loaded later", revision: 3 })));

      expect(
        await within(
          await screen.findByRole("textbox", { name: "Page text" }),
        ).findByText("Loaded later"),
      ).toBeVisible();

      act(() => setLoaded(view({}, { content: "Other page", id: "p2" })));

      expect(
        await within(
          await screen.findByRole("textbox", { name: "Page text" }),
        ).findByText("Other page"),
      ).toBeVisible();
    });
  });

  it("marks and unmarks a favorite", async () => {
    const { layoutSubmissions } = screenOf(view());

    await userEvent.click(
      await screen.findByRole("button", { name: "Mark as favorite" }),
    );

    await waitFor(() =>
      expect(layoutSubmissions[0]).toEqual({
        favorite: "1",
        intent: "set-favorite",
        pageId: "p1",
      }),
    );
  });

  it("removes a favorite", async () => {
    const { layoutSubmissions } = screenOf(view({ isFavorite: true }));

    await userEvent.click(
      await screen.findByRole("button", { name: "Remove favorite" }),
    );

    await waitFor(() =>
      expect(layoutSubmissions[0]).toMatchObject({ favorite: "0" }),
    );
  });
});

describe("WikiShell", () => {
  it("opens the search from the sidebar and with Ctrl+K unless the editor used the key", async () => {
    renderInWiki(<WikiShell navigation={NAVIGATION} people={[]} />, {
      path: "/wiki/p1",
    });

    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    act(() => {
      window.dispatchEvent(new Event(WIKI_SEARCH_EVENT));
    });
    expect(await screen.findByRole("dialog")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const handled = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "k",
    });

    handled.preventDefault();
    act(() => {
      window.dispatchEvent(handled);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { ctrlKey: true, key: "k" });
    expect(await screen.findByRole("dialog")).toBeVisible();
  });
});

describe("WikiHomeView", () => {
  function renderHome(home: Parameters<typeof WikiHomeView>[0]["home"]) {
    return renderInWiki(<WikiHomeView feed={[]} home={home} />);
  }

  it("lists the pages and a table of all of them", async () => {
    const all = [
      summary("1", { icon: "📘" }),
      summary("2", { scope: "private" }),
      summary("3", { projectName: "Project One", scope: "project" }),
    ];

    renderHome({
      all,
      favorites: [all[0] as WikiPageSummary],
      mine: all,
      recentlyEdited: all,
    });

    expect(await screen.findByRole("heading", { name: "Wiki" })).toBeVisible();

    const table = screen.getByRole("region", { name: "All pages" });
    const rows = within(table).getAllByRole("row");

    expect(rows).toHaveLength(4);
    expect(
      within(rows[2] as HTMLElement).getByText("Private", { selector: "td" }),
    ).toBeVisible();
    expect(
      within(rows[3] as HTMLElement).getByText("Project One"),
    ).toBeVisible();
    expect(within(rows[1] as HTMLElement).getByText("General")).toBeVisible();
    expect(screen.getAllByLabelText("Private").length).toBeGreaterThan(0);
  });

  it("explains empty lists", async () => {
    renderHome({ all: [], favorites: [], mine: [], recentlyEdited: [] });

    expect(await screen.findByText("No favorites yet.")).toBeVisible();
    expect(screen.getByText("Nothing edited yet.")).toBeVisible();
    expect(screen.getByText("You do not own any pages yet.")).toBeVisible();
    expect(screen.getByText(/There are no pages yet/)).toBeVisible();
  });
});

describe("WikiTrashView", () => {
  const entry = {
    daysLeft: 1,
    deletedAt: "2026-10-01 12:00:00",
    deletedByName: "Max",
    icon: "📘",
    id: "p1",
    ownerId: "o1",
    ownerName: "Olga",
    parentTitle: null,
    projectName: null,
    scope: "instance" as const,
    title: "Guide",
  };

  it("lists deleted pages with their remaining time", async () => {
    renderInWiki(
      <WikiTrashView
        entries={[
          entry,
          {
            ...entry,
            daysLeft: 12,
            deletedByName: null,
            icon: null,
            id: "p2",
            title: "Other",
          },
        ]}
      />,
    );

    expect(await screen.findByText("1 day left")).toBeVisible();
    expect(screen.getByText("12 days left")).toBeVisible();
    expect(screen.getByText(/2026-10-01.*Max/)).toBeVisible();
  });

  it("restores and purges after confirmation", async () => {
    const { layoutSubmissions } = renderInWiki(
      <WikiTrashView entries={[entry]} />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Restore" }),
    );

    const restore = await screen.findByRole("dialog", {
      name: "Restore “Guide”?",
    });

    await userEvent.click(
      within(restore).getByRole("button", { name: "Restore" }),
    );
    await waitFor(() =>
      expect(layoutSubmissions[0]).toEqual({
        intent: "restore-page",
        pageId: "p1",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await userEvent.click(
      screen.getByRole("button", { name: "Delete permanently" }),
    );

    const purge = await screen.findByRole("dialog", {
      name: "Delete “Guide” permanently?",
    });

    await userEvent.click(
      within(purge).getByRole("button", { name: "Delete permanently" }),
    );
    await waitFor(() =>
      expect(layoutSubmissions[1]).toEqual({
        intent: "purge-page",
        pageId: "p1",
      }),
    );
  });

  it("explains an empty trash", async () => {
    renderInWiki(<WikiTrashView entries={[]} />);

    expect(await screen.findByText("The trash is empty.")).toBeVisible();
  });
});

describe("wiki route components", () => {
  const shell = {
    navigation: NAVIGATION,
    people: [{ displayName: "Olga", id: "o1" }],
    templates: [],
    today: "2026-10-07",
  };

  function renderRoutes(
    path: string,
    pageData: unknown | ((pageId: string) => unknown) = null,
    language: (typeof LANGUAGE)[keyof typeof LANGUAGE] = LANGUAGE.ENGLISH,
  ) {
    const router = createMemoryRouter(
      [
        {
          Component: WikiRoute,
          children: [
            {
              Component: WikiHomeRoute,
              index: true,
              loader: () => ({
                feed: [],
                home: { all: [], favorites: [], mine: [], recentlyEdited: [] },
              }),
            },
            {
              Component: WikiTrashRoute,
              loader: () => ({ entries: [] }),
              path: "trash",
            },
            {
              Component: WikiPageRoute,
              loader: ({ params }) =>
                typeof pageData === "function"
                  ? pageData(params.pageId)
                  : pageData,
              path: ":pageId/:slug?",
            },
          ],
          id: "routes/wiki",
          loader: () => shell,
          path: "/wiki",
        },
      ],
      { initialEntries: [path] },
    );

    return {
      ...render(
        <I18nextProvider i18n={createI18n(language)}>
          <RegionProvider
            region={{ dateFormat: "YYYY-MM-DD", timezone: "UTC" }}
          >
            <RouterProvider router={router} />
          </RegionProvider>
        </I18nextProvider>,
      ),
      router,
    };
  }

  it("renders the frame with the start page and the trash", async () => {
    renderRoutes("/wiki");

    expect(await screen.findByRole("heading", { name: "Wiki" })).toBeVisible();
    // The navigation lives in the main sidebar since A8.1.
    expect(
      screen.queryByRole("navigation", { name: "Wiki navigation" }),
    ).toBeNull();

    renderRoutes("/wiki/trash");

    expect(await screen.findAllByText("The trash is empty.")).not.toHaveLength(
      0,
    );
  });

  it("renders a page, the placeholder and the neutral notice", async () => {
    renderRoutes("/wiki/p1", {
      anchorChoices: {
        departments: [],
        epics: [],
        milestones: [],
        selected: [],
      },
      attachments: [],
      comments: [],
      backlinks: { pages: [], projects: [], tickets: [] },
      kind: "page",
      versions: [],
      view: view(),
    });

    expect(
      await screen.findByRole("heading", { name: "Heading" }),
    ).toBeVisible();
  });

  it("starts every page afresh: no dialog or editor carries over to the next page", async () => {
    const pageData = (pageId: string) => ({
      anchorChoices: {
        departments: [],
        epics: [],
        milestones: [],
        selected: [],
      },
      attachments: [],
      backlinks: { pages: [], projects: [], tickets: [] },
      comments: [],
      kind: "page",
      versions: [],
      view: view({}, { id: pageId, title: `Title ${pageId}` }),
    });
    const { router } = renderRoutes("/wiki/p1", pageData);

    await userEvent.click(
      await screen.findByRole("button", { name: "Page menu" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Duplicate" }),
    );

    expect(await screen.findByRole("dialog")).toBeVisible();

    await act(() => router.navigate("/wiki/p2"));

    expect(await screen.findByDisplayValue("Title p2")).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("renders the placeholder of a private page", async () => {
    renderRoutes("/wiki/p1", {
      kind: "placeholder",
      placeholder: { id: "p1", ownerId: "o", ownerName: "Olga" },
    });

    expect(await screen.findByText("PRIVATE")).toBeInTheDocument();
  });

  it("renders the neutral notice for a missing page", async () => {
    renderRoutes("/wiki/p1", { kind: "notFound" });

    expect(
      (await screen.findAllByText("Not found or no access.")).length,
    ).toBeGreaterThan(0);
  });

  it("falls back to the notice when the layout data is missing", async () => {
    const router = createMemoryRouter(
      [
        {
          Component: WikiPageRoute,
          loader: () => ({ kind: "page" }),
          path: "/wiki/:pageId",
        },
      ],
      { initialEntries: ["/wiki/p1"] },
    );

    render(
      <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
        <RouterProvider router={router} />
      </I18nextProvider>,
    );

    expect(
      await screen.findByText("Nicht gefunden oder kein Zugriff."),
    ).toBeVisible();
  });
});
