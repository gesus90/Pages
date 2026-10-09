// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import { MarkdownText } from "@/app/components/markdown/markdown-text";
import { WikiBacklinksView } from "@/app/components/wiki/wiki-backlinks-view";
import { WikiSearchDialog } from "@/app/components/wiki/wiki-search-dialog";
import { WikiShell } from "@/app/components/wiki/wiki-shell";
import { createI18n } from "@/app/lib/i18n";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  readWikiPageId,
  requestWikiLinkTitle,
} from "@/app/lib/wiki-link-titles";
import {
  readSearchParams,
  writeSearchParams,
} from "@/app/lib/wiki-search-params";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { loader as linkTitlesLoader } from "@/app/routes/wiki-link-titles";
import { loader as referencesLoader } from "@/app/routes/wiki-references";
import { loader as searchLoader } from "@/app/routes/wiki-search";
import { WikiValidationError } from "@/backend/error/WikiErrors";
import { LANGUAGE } from "@/language/Language";

import { createUser } from "../helpers/factories";
import { renderInWiki } from "../helpers/wiki-render";

import type { WikiNavigation, WikiSearchResponse } from "@/definition/Wiki";
import { RouterContextProvider } from "react-router";

const NAVIGATION: WikiNavigation = {
  canCreate: true,
  expandedIds: [],
  favoriteIds: [],
  nodes: [],
  projects: [{ id: "pr1", name: "Project One" }],
  recent: [
    { icon: "📘", id: "r1", title: "Recent page" },
    { icon: null, id: "r2", title: "Plain recent" },
  ],
};

const RESPONSE: WikiSearchResponse = {
  results: [
    {
      createdAt: "2026-01-01 10:00:00",
      currentUntil: null,
      icon: "📘",
      id: "p1",
      ownerId: "o",
      ownerName: "Olga",
      parentId: null,
      projectId: null,
      projectName: null,
      scope: "instance",
      snippet: "…the budget plan…",
      title: "Budget",
      updatedAt: "2026-01-02 10:00:00",
    },
    {
      createdAt: "2026-01-01 10:00:00",
      currentUntil: null,
      icon: null,
      id: "p2",
      ownerId: "o",
      ownerName: "Olga",
      parentId: null,
      projectId: "pr1",
      projectName: "Project One",
      scope: "project",
      snippet: "",
      title: "Project budget",
      updatedAt: "2026-01-02 10:00:00",
    },
    {
      createdAt: "2026-01-01 10:00:00",
      currentUntil: null,
      icon: null,
      id: "p3",
      ownerId: "o",
      ownerName: "Olga",
      parentId: null,
      projectId: null,
      projectName: null,
      scope: "private",
      snippet: "x",
      title: "My budget",
      updatedAt: "2026-01-02 10:00:00",
    },
  ],
  total: 3,
};

describe("search parameters", () => {
  it("round-trips the filters", () => {
    const input = {
      creatorId: "u1",
      editedFrom: "2026-01-01",
      editedTo: "2026-02-01",
      location: "project:p1",
      sort: "edited",
      text: '"exact phrase" word',
      titleOnly: true,
      underPageId: "page-1",
    };

    expect(
      readSearchParams(new URLSearchParams(writeSearchParams(input))),
    ).toEqual(input);
  });

  it("leaves out what is empty", () => {
    expect(
      writeSearchParams({
        ...readSearchParams(new URLSearchParams()),
        text: "  ",
      }),
    ).toBe("");
    expect(
      readSearchParams(new URLSearchParams("q=a&location=%20")),
    ).toMatchObject({
      location: null,
      text: "a",
      titleOnly: false,
    });
  });
});

describe("WikiSearchDialog", () => {
  function setup(pageId: string | null = "p1") {
    const onClose = vi.fn();
    const endpoints = {
      "/wiki-api/search": (url: URL) =>
        url.searchParams.get("q") === "nothing"
          ? { results: [], total: 0 }
          : RESPONSE,
    };
    const rendered = renderInWiki(
      <WikiSearchDialog
        navigation={NAVIGATION}
        pageId={pageId}
        people={[{ displayName: "Olga", id: "o" }]}
        onClose={onClose}
      />,
      { endpoints, path: "/wiki/p1" },
    );

    return { ...rendered, onClose };
  }

  it("shows recent pages while nothing is typed", async () => {
    setup();

    expect(await screen.findByText("Recently visited")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "📘 Recent page" }),
    ).toHaveAttribute("href", "/wiki/r1/recent-page");
  });

  it("explains an empty list of recent pages", async () => {
    renderInWiki(
      <WikiSearchDialog
        navigation={{ ...NAVIGATION, recent: [] }}
        pageId={null}
        people={[]}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("No pages visited yet.")).toBeVisible();
  });

  it("searches after typing and lists hits with their location and passage", async () => {
    const { loads, onClose } = setup();

    await userEvent.type(await screen.findByLabelText("Search text"), "budget");

    const hits = await screen.findAllByRole("link", { name: /budget/i });

    expect(hits).toHaveLength(3);
    expect(loads.at(-1)).toBe("/wiki-api/search?q=budget&sort=relevance");
    expect(screen.getByText("3 results")).toBeVisible();
    expect(
      within(hits[0] as HTMLElement).getByText("…the budget plan…"),
    ).toBeVisible();
    expect(within(hits[0] as HTMLElement).getByText("General")).toBeVisible();
    expect(
      within(hits[1] as HTMLElement).getByText("Project One"),
    ).toBeVisible();
    expect(within(hits[2] as HTMLElement).getByText("Private")).toBeVisible();

    await userEvent.click(hits[0] as HTMLElement);

    expect(onClose).toHaveBeenCalled();
  });

  it("shows that a new search is running while the old hits stay", async () => {
    renderInWiki(
      <WikiSearchDialog
        navigation={NAVIGATION}
        pageId={null}
        people={[]}
        onClose={vi.fn()}
      />,
      {
        endpoints: {
          "/wiki-api/search": async (url: URL) => {
            if (url.searchParams.get("q") === "budget plan") {
              await new Promise((resolve) => setTimeout(resolve, 600));
            }

            return RESPONSE;
          },
        },
      },
    );

    const input = await screen.findByLabelText("Search text");

    await userEvent.type(input, "budget");
    await screen.findByText("3 results");
    await userEvent.type(input, " plan");

    expect(await screen.findByText("Searching…")).toBeVisible();
    expect(await screen.findByText("3 results")).toBeVisible();
  });

  it("says so when nothing matches", async () => {
    setup();

    await userEvent.type(
      await screen.findByLabelText("Search text"),
      "nothing",
    );

    expect(await screen.findByText("No results.")).toBeVisible();
  });

  it("applies filters", async () => {
    const { loads } = setup();

    await userEvent.click(
      await screen.findByRole("button", { name: "Filters" }),
    );
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Titles only" }),
    );
    await userEvent.click(
      screen.getByRole("checkbox", {
        name: "Only in this page and its subpages",
      }),
    );
    fireEvent.change(screen.getByLabelText("Edited from"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByLabelText("Edited until"), {
      target: { value: "2026-12-31" },
    });
    await userEvent.click(screen.getByRole("combobox", { name: "Location" }));
    await userEvent.click(
      await screen.findByRole("option", { name: "Project One" }),
    );
    await userEvent.click(screen.getByRole("combobox", { name: "Creator" }));
    await userEvent.click(await screen.findByRole("option", { name: "Olga" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Sort by" }));
    await userEvent.click(
      await screen.findByRole("option", { name: "Last edited" }),
    );

    await waitFor(() => expect(loads.length).toBeGreaterThan(0));
    await waitFor(() =>
      expect(loads.at(-1)).toBe(
        "/wiki-api/search?location=project%3Apr1&under=p1&creator=o&from=2026-01-01&to=2026-12-31&sort=edited&titleOnly=1",
      ),
    );

    await userEvent.click(screen.getByRole("button", { name: "Filters" }));

    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("offers no page filter outside a page", async () => {
    setup(null);

    await userEvent.click(
      await screen.findByRole("button", { name: "Filters" }),
    );

    expect(
      screen.queryByRole("checkbox", {
        name: "Only in this page and its subpages",
      }),
    ).toBeNull();
  });
});

describe("WikiShell search", () => {
  it("opens with Ctrl+K and Cmd+K but not with other keys", async () => {
    renderInWiki(<WikiShell navigation={NAVIGATION} people={[]} />, {
      path: "/wiki/p1",
    });

    await waitFor(() => {
      fireEvent.keyDown(window, { ctrlKey: true, key: "k" });
      expect(
        screen.getByRole("dialog", { name: "Search the wiki" }),
      ).toBeVisible();
    });

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(
      await screen.findByRole("dialog", { name: "Search the wiki" }),
    ).toBeVisible();

    await userEvent.keyboard("{Escape}");
    fireEvent.keyDown(window, { key: "k" });
    fireEvent.keyDown(window, { ctrlKey: true, key: "j" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("WikiBacklinksView", () => {
  it("lists pages, tickets and projects", async () => {
    renderInWiki(
      <WikiBacklinksView
        backlinks={{
          pages: [{ icon: null, id: "a", title: "Source page" }],
          projects: [{ id: "pr", name: "Project" }],
          tickets: [{ id: "t", key: "PAG-1", title: "Ticket" }],
        }}
      />,
    );

    expect(
      await screen.findByRole("link", { name: "Source page" }),
    ).toHaveAttribute("href", "/wiki/a/source-page");
    expect(screen.getByRole("link", { name: "PAG-1 Ticket" })).toHaveAttribute(
      "href",
      "/aufgaben/PAG-1",
    );
    expect(screen.getByRole("link", { name: "Project" })).toHaveAttribute(
      "href",
      "/projekte/pr",
    );
  });

  it("renders nothing without mentions", async () => {
    const { container } = renderInWiki(
      <WikiBacklinksView
        backlinks={{ pages: [], projects: [], tickets: [] }}
      />,
    );

    await waitFor(() => expect(container.querySelector("section")).toBeNull());
  });
});

describe("wiki link titles", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        json: async () => ({
          titles: String(url).includes("known") ? { known: "Known page" } : {},
        }),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads page identifiers out of wiki paths only", () => {
    expect(readWikiPageId("/wiki/abc")).toBe("abc");
    expect(readWikiPageId("/wiki/abc/slug#top")).toBe("abc");
    expect(readWikiPageId("/wiki/abc?x=1")).toBe("abc");
    expect(readWikiPageId("/wiki")).toBeNull();
    expect(readWikiPageId("/wiki/trash")).toBeNull();
    expect(readWikiPageId("/wiki/attachments/x")).toBeNull();
    expect(readWikiPageId("/aufgaben/PAG-1")).toBeNull();
  });

  it("asks once for links requested at the same time", async () => {
    const [known, hidden, again] = await Promise.all([
      requestWikiLinkTitle("known"),
      requestWikiLinkTitle("hidden"),
      requestWikiLinkTitle("known"),
    ]);

    expect([known, hidden, again]).toEqual(["Known page", null, "Known page"]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("treats failed requests and odd answers as no title", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    expect(await requestWikiLinkTitle("known")).toBeNull();

    vi.mocked(fetch).mockResolvedValueOnce({
      json: async () => "garbage",
    } as Response);
    expect(await requestWikiLinkTitle("known")).toBeNull();

    vi.mocked(fetch).mockResolvedValueOnce({
      json: async () => ({ titles: null }),
    } as Response);
    expect(await requestWikiLinkTitle("known")).toBeNull();

    vi.mocked(fetch).mockResolvedValueOnce({
      json: async () => null,
    } as Response);
    expect(await requestWikiLinkTitle("known")).toBeNull();
  });

  function renderMarkdown(source: string) {
    const router = createMemoryRouter([
      { element: <MarkdownText source={source} />, path: "/" },
    ]);

    return render(
      <I18nextProvider i18n={createI18n(LANGUAGE.ENGLISH)}>
        <RouterProvider router={router} />
      </I18nextProvider>,
    );
  }

  it("shows the title of a visible page in place of a bare address", async () => {
    renderMarkdown("[/wiki/known](/wiki/known)");

    expect(
      await screen.findByRole("link", { name: /Known page/ }),
    ).toHaveAttribute("href", "/wiki/known");
  });

  it("keeps the written text and adds the title as a hint", async () => {
    renderMarkdown("[read this](/wiki/known)");

    const link = await screen.findByRole("link", { name: /read this/ });

    await waitFor(() => expect(link).toHaveAttribute("title", "Known page"));
  });

  it("shows only the link for a hidden page", async () => {
    renderMarkdown("[/wiki/secret](/wiki/secret)");

    const link = await screen.findByRole("link");

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(link).not.toHaveAttribute("title");
    expect(link).toHaveTextContent("/wiki/secret");
  });

  it("does not ask for other links", async () => {
    renderMarkdown("[ticket](/aufgaben/PAG-1)");

    await screen.findByRole("link");

    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe("wiki endpoints", () => {
  const user = createUser();
  const search = vi.fn();
  const references = vi.fn();
  const linkTitles = vi.fn();

  beforeEach(() => {
    vi.mocked(getApplicationServices).mockResolvedValue({
      wikiService: { linkTitles, references, search },
    } as never);
  });

  function context(actor: typeof user | null): RouterContextProvider {
    const provider = new RouterContextProvider();

    if (actor) {
      provider.set(authenticatedUserContext, actor);
    }

    return provider;
  }

  async function body(response: Response): Promise<unknown> {
    return response.json();
  }

  it("searches for the signed-in person", async () => {
    search.mockResolvedValue({ results: [], total: 0 });

    const response = await searchLoader({
      context: context(user),
      request: new Request("http://localhost/wiki-api/search?q=a&sort=edited"),
    } as never);

    expect(await body(response)).toEqual({ results: [], total: 0 });
    expect(search).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ sort: "edited", text: "a" }),
    );
  });

  it("answers an invalid filter with an empty result and passes other errors on", async () => {
    const args = {
      context: context(user),
      request: new Request("http://localhost/wiki-api/search?from=x"),
    } as never;

    search.mockRejectedValueOnce(new WikiValidationError("invalidDate"));
    expect(await body(await searchLoader(args))).toEqual({
      results: [],
      total: 0,
    });

    search.mockRejectedValueOnce(new Error("boom"));
    await expect(searchLoader(args)).rejects.toThrow("boom");
  });

  it("refuses requests without a user", async () => {
    const args = {
      context: context(null),
      request: new Request("http://localhost/x"),
    } as never;

    await expect(searchLoader(args)).rejects.toMatchObject({ status: 403 });
    await expect(referencesLoader(args)).rejects.toMatchObject({ status: 403 });
    await expect(linkTitlesLoader(args)).rejects.toMatchObject({ status: 403 });
  });

  it("offers references and resolves titles", async () => {
    references.mockResolvedValue([{ kind: "ticket", key: "A-1", title: "t" }]);
    linkTitles.mockResolvedValue({ a: "Page A" });

    const ask = (path: string) =>
      ({
        context: context(user),
        request: new Request(`http://localhost${path}`),
      }) as never;

    expect(
      await body(await referencesLoader(ask("/wiki-api/references?q=a"))),
    ).toEqual({
      references: [{ key: "A-1", kind: "ticket", title: "t" }],
    });
    expect(references).toHaveBeenCalledWith(user, "a");
    await referencesLoader(ask("/wiki-api/references"));
    expect(references).toHaveBeenLastCalledWith(user, "");

    expect(
      await body(await linkTitlesLoader(ask("/wiki-api/link-titles?ids=a,,b"))),
    ).toEqual({
      titles: { a: "Page A" },
    });
    expect(linkTitles).toHaveBeenCalledWith(user, ["a", "b"]);
    await linkTitlesLoader(ask("/wiki-api/link-titles"));
    expect(linkTitles).toHaveBeenLastCalledWith(user, []);

    const many = Array.from({ length: 80 }, (_, index) => `id${index}`).join(
      ",",
    );

    await linkTitlesLoader(ask(`/wiki-api/link-titles?ids=${many}`));
    expect((linkTitles.mock.calls.at(-1)?.[1] as string[]).length).toBe(50);
  });
});
