import { screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { handleWikiPageAction } from "@/app/lib/wiki-actions/wiki-page-actions.server";
import WikiPageRoute, {
  action,
  loader,
  shouldRevalidate,
} from "@/app/routes/wiki-page";
import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import {
  ACTOR,
  formPost,
  i18n,
  pagesRequest,
  renderRoute,
  responseOf,
  routeArgumentsWith,
} from "./route-fixture";

const wiki = vi.hoisted(() => ({
  read: vi.fn(),
  listVersions: vi.fn(),
  anchorChoices: vi.fn(),
  backlinks: vi.fn(),
  listAttachments: vi.fn(),
  listComments: vi.fn(),
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async (): Promise<unknown> => ({
    wikiService: wiki,
  }),
}));
vi.mock("@/app/lib/wiki-actions/wiki-page-actions.server", () => ({
  handleWikiPageAction: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));
vi.mock("@/app/components/wiki/wiki-private-placeholder", () => ({
  WikiPrivatePlaceholderView: (props: {
    readonly placeholder: { readonly ownerName: string };
  }): React.ReactElement => <p>{`private ${props.placeholder.ownerName}`}</p>,
}));
vi.mock("@/app/components/wiki/wiki-page-screen", () => ({
  WikiPageScreen: (props: {
    readonly view: { readonly page: { readonly title: string } };
    readonly today: string;
    readonly owners: readonly unknown[];
  }): React.ReactElement => (
    <p>{`screen ${props.view.page.title} ${props.today} ${props.owners.length}`}</p>
  ),
}));

const PAGE = { id: "page-1", title: "Release Notes" };

/**
 * Loader arguments for a page address.
 *
 * @param slug - Slug of the address, if any.
 * @param user - The signed-in user.
 */
function pageArguments(
  slug?: string,
  user: typeof ACTOR | null = ACTOR,
): ReturnType<typeof routeArgumentsWith<{ pageId: string; slug?: string }>> {
  return routeArgumentsWith(
    pagesRequest(`/wiki/page-1${slug === undefined ? "" : `/${slug}`}`),
    { pageId: "page-1", ...(slug === undefined ? {} : { slug }) },
    { user },
  );
}

/**
 * Revalidation arguments after a submission with one intent.
 *
 * @param intent - The submitted intent.
 */
function revalidation(intent: string): {
  readonly formData: FormData;
  readonly defaultShouldRevalidate: boolean;
} {
  const formData = new FormData();
  formData.set("intent", intent);
  return { formData, defaultShouldRevalidate: true };
}

beforeEach(() => {
  vi.clearAllMocks();
  wiki.read.mockResolvedValue({
    kind: "page",
    view: { page: PAGE, permissions: { canManage: false } },
  });
  wiki.listVersions.mockResolvedValue([]);
  wiki.anchorChoices.mockResolvedValue({ projects: [] });
  wiki.backlinks.mockResolvedValue({ pages: [] });
  wiki.listComments.mockResolvedValue([]);
  wiki.listAttachments.mockResolvedValue([
    { id: "mine", uploadedBy: "user-1" },
    { id: "theirs", uploadedBy: "user-2" },
  ]);
});

it("requires the user of the authentication middleware", async () => {
  await expect(loader(pageArguments(undefined, null))).rejects.toThrow(
    "Authenticated middleware did not provide a user.",
  );
});

it("shows the placeholder of a private page", async () => {
  wiki.read.mockResolvedValue({
    kind: "placeholder",
    placeholder: { ownerName: "Grace" },
  });

  await expect(loader(pageArguments())).resolves.toEqual({
    kind: "placeholder",
    placeholder: { ownerName: "Grace" },
  });
});

it("replaces a slug that no longer fits the title", async () => {
  const response = await responseOf(loader(pageArguments("old-title")));

  expect(response.headers.get("Location")).toBe("/wiki/page-1/release-notes");
});

it("loads the page with what its panels show", async () => {
  const loaded = await loader(pageArguments("release-notes"));

  expect(loaded).toMatchObject({
    kind: "page",
    anchorChoices: { projects: [] },
    attachments: [
      { id: "mine", canRemove: true },
      { id: "theirs", canRemove: false },
    ],
  });
  expect(wiki.listVersions).toHaveBeenCalledWith(ACTOR, "page-1");
});

it("lets a manager remove every attachment", async () => {
  wiki.read.mockResolvedValue({
    kind: "page",
    view: { page: PAGE, permissions: { canManage: true } },
  });

  const loaded = await loader(pageArguments());

  expect(loaded).toMatchObject({
    attachments: [{ canRemove: true }, { canRemove: true }],
  });
});

it("answers a missing page with the neutral notice", async () => {
  const missing = new WikiPageNotFoundError();
  wiki.read.mockRejectedValue(missing);

  await expect(loader(pageArguments())).resolves.toEqual({
    kind: "notFound",
  });
  expect(logCaughtError).toHaveBeenCalledWith("wiki_page", missing);
});

it("passes other failures on", async () => {
  wiki.read.mockRejectedValue(new Error("database down"));

  await expect(loader(pageArguments())).rejects.toThrow("database down");
});

it("hands a page change to the page actions", async () => {
  const outcome = new Response(null, { status: 204 });
  vi.mocked(handleWikiPageAction).mockResolvedValue(outcome);

  await expect(
    action(
      routeArgumentsWith(
        formPost("/wiki/page-1", { intent: "save" }),
        { pageId: "page-1" },
        { user: ACTOR },
      ),
    ),
  ).resolves.toBe(outcome);
  expect(vi.mocked(handleWikiPageAction).mock.calls[0]?.[0].pageId).toBe(
    "page-1",
  );
});

it("keeps the editor's data while autosave runs", () => {
  expect(shouldRevalidate(revalidation("save"))).toBe(false);
  expect(shouldRevalidate(revalidation("restore-version"))).toBe(true);
  expect(shouldRevalidate({ defaultShouldRevalidate: false })).toBe(false);
});

it("renders the private placeholder", () => {
  renderRoute(WikiPageRoute, {
    loaderData: { kind: "placeholder", placeholder: { ownerName: "Grace" } },
  });

  expect(screen.getByText("private Grace")).toBeTruthy();
});

it("shows the neutral notice for a missing page", () => {
  renderRoute(WikiPageRoute, {
    loaderData: { kind: "notFound" },
    parent: { id: "routes/wiki", loaderData: {} },
  });

  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("wiki.page.notFound"),
  );
});

it("shows the notice without the wiki frame", () => {
  renderRoute(WikiPageRoute, {
    loaderData: { kind: "page", view: { page: PAGE } },
  });

  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("wiki.page.notFound"),
  );
});

it("renders the page with the data of the wiki frame", () => {
  renderRoute(WikiPageRoute, {
    loaderData: {
      kind: "page",
      view: { page: PAGE },
      versions: [],
      anchorChoices: {},
      backlinks: {},
      attachments: [],
      comments: [],
    },
    parent: {
      id: "routes/wiki",
      loaderData: {
        navigation: {},
        people: [{ id: "user-2" }],
        templates: [],
        today: "2026-10-28",
      },
    },
  });

  expect(screen.getByText("screen Release Notes 2026-10-28 1")).toBeTruthy();
});
