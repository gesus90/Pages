import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";
import {
  action as layoutAction,
  loader as layoutLoader,
} from "@/app/routes/wiki";
import { loader as homeLoader } from "@/app/routes/wiki-home";
import {
  action as pageAction,
  loader as pageLoader,
  shouldRevalidate,
} from "@/app/routes/wiki-page";
import { loader as trashLoader } from "@/app/routes/wiki-trash";

import { createUser } from "../helpers/factories";

const mockedServices = vi.mocked(getApplicationServices);
const user = createUser();

function createContext(actor = user): RouterContextProvider {
  const context = new RouterContextProvider();

  if (actor) {
    context.set(authenticatedUserContext, actor);
  }

  return context;
}

function mockWiki(wikiService: Record<string, unknown>): void {
  mockedServices.mockResolvedValue({ wikiService } as never);
}

function pageArgs(
  pageId: string,
  slug?: string,
): Parameters<typeof pageLoader>[0] {
  return {
    context: createContext(),
    params: { pageId, slug },
    request: new Request("http://localhost/wiki/" + pageId),
  } as never;
}

describe("wiki layout route", () => {
  beforeEach(() => {
    mockWiki({
      navigation: vi.fn().mockResolvedValue({ nodes: [] }),
      ownerCandidates: vi.fn().mockResolvedValue([{ id: "o" }]),
      templates: vi.fn().mockResolvedValue([]),
    });
  });

  it("loads the navigation, the templates and today", async () => {
    const data = await layoutLoader({ context: createContext() } as never);

    expect(data.navigation).toEqual({ nodes: [] });
    expect(data.templates).toEqual([]);
    expect(data.people).toEqual([{ id: "o" }]);
    expect(data.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("requires the authenticated user", async () => {
    const context = new RouterContextProvider();

    await expect(layoutLoader({ context } as never)).rejects.toThrow(
      "Authenticated middleware",
    );
    await expect(homeLoader({ context } as never)).rejects.toThrow(
      "Authenticated",
    );
    await expect(trashLoader({ context } as never)).rejects.toThrow(
      "Authenticated",
    );
    await expect(
      pageLoader({ context, params: { pageId: "x" } } as never),
    ).rejects.toThrow("Authenticated");
  });

  it("answers an unknown action intent with invalid input", async () => {
    const response = await layoutAction({
      context: createContext(),
      request: new Request("http://localhost/wiki", {
        body: new URLSearchParams({ intent: "nope" }),
        method: "POST",
      }),
    } as never);

    expect(response).toMatchObject({ data: { error: "invalidInput" } });
  });
});

describe("wiki start and trash routes", () => {
  it("loads the start page lists", async () => {
    mockWiki({
      forMe: vi.fn().mockResolvedValue([{ reason: "mention" }]),
      home: vi.fn().mockResolvedValue({ all: [] }),
    });

    expect(await homeLoader({ context: createContext() } as never)).toEqual({
      feed: [{ reason: "mention" }],
      home: { all: [] },
    });
  });

  it("adds the remaining days to trash entries", async () => {
    const recent = new Date(Date.now() - 2 * 86_400_000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");

    mockWiki({
      getSettings: vi.fn().mockResolvedValue({ trashRetentionDays: 30 }),
      listTrash: vi.fn().mockResolvedValue([
        { deletedAt: recent, id: "a" },
        { deletedAt: "2000-01-01 00:00:00", id: "b" },
        { deletedAt: "garbage", id: "c" },
      ]),
    });

    const { entries } = await trashLoader({
      context: createContext(),
    } as never);

    expect(entries.map((entry) => entry.daysLeft)).toEqual([28, 0, 30]);
  });
});

describe("wiki page route", () => {
  const page = { id: "p1", title: "Hello World" };
  const view = (canManage: boolean) => ({
    page,
    permissions: { canComment: true, canEdit: true, canManage },
  });

  function service(overrides: Record<string, unknown> = {}): void {
    mockWiki({
      anchorChoices: vi.fn().mockResolvedValue({ selected: [] }),
      backlinks: vi
        .fn()
        .mockResolvedValue({ pages: [], projects: [], tickets: [] }),
      listAttachments: vi.fn().mockResolvedValue([
        { id: "a1", uploadedBy: "someone" },
        { id: "a2", uploadedBy: "user-1" },
      ]),
      listComments: vi.fn().mockResolvedValue([]),
      listVersions: vi.fn().mockResolvedValue([{ id: "v1" }]),
      read: vi.fn().mockResolvedValue({ kind: "page", view: view(true) }),
      ...overrides,
    });
  }

  it("loads a page with its versions, anchor choices and backlinks", async () => {
    service();

    expect(await pageLoader(pageArgs("p1"))).toMatchObject({
      attachments: [
        { canRemove: true, id: "a1" },
        { canRemove: true, id: "a2" },
      ],
      backlinks: { pages: [] },
      comments: [],
      kind: "page",
      versions: [{ id: "v1" }],
    });
    expect(await pageLoader(pageArgs("p1", "hello-world"))).toMatchObject({
      kind: "page",
    });
  });

  it("lets only the uploader remove attachments unless the person manages the page", async () => {
    service({
      read: vi.fn().mockResolvedValue({ kind: "page", view: view(false) }),
    });

    expect(await pageLoader(pageArgs("p1"))).toMatchObject({
      attachments: [
        { canRemove: false, id: "a1" },
        { canRemove: true, id: "a2" },
      ],
    });
  });

  it("redirects an outdated slug to the current title", async () => {
    service();

    const error = await pageLoader(pageArgs("p1", "old-title")).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Response);
    expect((error as Response).headers.get("Location")).toBe(
      "/wiki/p1/hello-world",
    );
  });

  it("returns the placeholder an administrator gets", async () => {
    service({
      read: vi
        .fn()
        .mockResolvedValue({ kind: "placeholder", placeholder: { id: "p1" } }),
    });

    expect(await pageLoader(pageArgs("p1"))).toEqual({
      kind: "placeholder",
      placeholder: { id: "p1" },
    });
  });

  it("answers a missing or hidden page with the neutral result", async () => {
    service({ read: vi.fn().mockRejectedValue(new WikiPageNotFoundError()) });

    expect(await pageLoader(pageArgs("p1"))).toEqual({ kind: "notFound" });
  });

  it("passes other failures on", async () => {
    service({ read: vi.fn().mockRejectedValue(new Error("boom")) });

    await expect(pageLoader(pageArgs("p1"))).rejects.toThrow("boom");
  });

  it("hands page actions the page of the route", async () => {
    service();

    const response = await pageAction({
      context: createContext(),
      params: { pageId: "p1" },
      request: new Request("http://localhost/wiki/p1", {
        body: new URLSearchParams({ intent: "nope" }),
        method: "POST",
      }),
    } as never);

    expect(response).toMatchObject({ data: { error: "invalidInput" } });
  });

  it("skips revalidation only while saving", () => {
    const save = new FormData();
    const other = new FormData();

    save.set("intent", "save");
    other.set("intent", "set-owner");

    expect(
      shouldRevalidate({ defaultShouldRevalidate: true, formData: save }),
    ).toBe(false);
    expect(
      shouldRevalidate({ defaultShouldRevalidate: true, formData: other }),
    ).toBe(true);
    expect(shouldRevalidate({ defaultShouldRevalidate: false })).toBe(false);
  });
});
