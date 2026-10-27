import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readWikiPageId,
  requestWikiLinkTitle,
} from "@/app/lib/wiki-link-titles";

describe("reading the page id of a wiki path", () => {
  it.each([
    { path: "/wiki/abc-123", id: "abc-123" },
    { path: "/wiki/abc/some-title", id: "abc" },
    { path: "/wiki/abc/", id: "abc" },
    { path: "/wiki/abc?x=1", id: "abc" },
    { path: "/wiki/abc/title#top", id: "abc" },
  ])("reads $id from $path", ({ path, id }) => {
    expect(readWikiPageId(path)).toBe(id);
  });

  it.each([
    "/wiki",
    "/wiki/",
    "/wiki/attachments",
    "/wiki/trash",
    "/other/abc",
    "https://x.example/wiki/abc",
    "/wiki/a b",
  ])("reads nothing from %s", (path) => {
    expect(readWikiPageId(path)).toBeNull();
  });
});

describe("requesting link titles", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function answer(body: unknown): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async () => ({ json: async () => body }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("collects the requests of one tick into a single call and answers each page", async () => {
    const fetchMock = answer({ titles: { a: "Alpha", b: "Beta" } });

    const first = requestWikiLinkTitle("a");
    const again = requestWikiLinkTitle("a");
    const second = requestWikiLinkTitle("b");
    const missing = requestWikiLinkTitle("c");
    await vi.runAllTimersAsync();

    await expect(Promise.all([first, again, second, missing])).resolves.toEqual(
      ["Alpha", "Alpha", "Beta", null],
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "/wiki-api/link-titles?ids=a%2Cb%2Cc",
    );
  });

  it("starts a new batch for requests after the first one was sent", async () => {
    const fetchMock = answer({ titles: { a: "Alpha" } });

    const first = requestWikiLinkTitle("a");
    await vi.runAllTimersAsync();
    const second = requestWikiLinkTitle("a");
    await vi.runAllTimersAsync();

    await expect(Promise.all([first, second])).resolves.toEqual([
      "Alpha",
      "Alpha",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    { label: "an answer without titles", body: {} },
    { label: "an answer that is not an object", body: "text" },
    { label: "an answer that is null", body: null },
    { label: "titles that are null", body: { titles: null } },
  ])("answers null for $label", async ({ body }) => {
    answer(body);

    const title = requestWikiLinkTitle("a");
    await vi.runAllTimersAsync();

    await expect(title).resolves.toBeNull();
  });

  it("answers null when the call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("offline"))),
    );

    const title = requestWikiLinkTitle("a");
    await vi.runAllTimersAsync();

    await expect(title).resolves.toBeNull();
  });
});
