// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useWikiEditorFeatures } from "@/app/components/wiki/use-wiki-editor-features";
import { createI18n } from "@/app/lib/i18n";
import {
  readReferences,
  toEditorReference,
} from "@/app/lib/wiki-editor-references";
import { LANGUAGE } from "@/language/Language";

import type { WikiUploadsState } from "@/app/components/wiki/use-wiki-uploads";
import type { WikiAttachment } from "@/definition/Wiki";

const hintOf = (kind: string): string => `hint:${kind}`;

describe("editor references", () => {
  it("reads only well-formed references", () => {
    const page = { icon: null, id: "p", kind: "page", title: "Page" };

    expect(
      readReferences({ references: [page, { kind: "x" }, null, 1] }),
    ).toEqual([page]);
    expect(readReferences({ references: "none" })).toEqual([]);
    expect(readReferences(null)).toEqual([]);
    expect(readReferences("text")).toEqual([]);
  });

  it("turns pages, tickets and people into menu entries", () => {
    expect(
      toEditorReference(
        { icon: "📘", id: "p1", kind: "page", title: "Guide" },
        hintOf,
      ),
    ).toEqual({
      hint: "hint:page",
      insertion: { href: "/wiki/p1", kind: "link", text: "Guide" },
      key: "page:p1",
      label: "📘 Guide",
    });
    expect(
      toEditorReference(
        { icon: null, id: "p2", kind: "page", title: "Plain" },
        hintOf,
      ).label,
    ).toBe("Plain");
    expect(
      toEditorReference({ key: "PAG-1", kind: "ticket", title: "Bug" }, hintOf),
    ).toEqual({
      hint: "hint:ticket",
      insertion: { href: "/aufgaben/PAG-1", kind: "link", text: "PAG-1" },
      key: "ticket:PAG-1",
      label: "PAG-1 Bug",
    });
    expect(
      toEditorReference(
        { displayName: "Ada L.", id: "u1", kind: "person", username: "ada" },
        hintOf,
      ),
    ).toEqual({
      hint: "hint:person",
      insertion: { kind: "text", text: "@ada " },
      key: "person:u1",
      label: "Ada L.",
    });
  });
});

describe("useWikiEditorFeatures", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function features(
    upload: WikiUploadsState["upload"] = vi.fn(async () => []),
  ) {
    const options = {
      onComment: vi.fn(),
      pageId: "p1",
      requestSubpage: vi.fn(async () => null),
      uploads: { errorCode: null, fileName: null, progress: null, upload },
    };
    const { result } = renderHook(() => useWikiEditorFeatures(options), {
      wrapper: ({ children }) => (
        <I18nextProvider i18n={createI18n(LANGUAGE.ENGLISH)}>
          {children}
        </I18nextProvider>
      ),
    });

    return { ...options, result: result.current };
  }

  it("links blocks, comments, creates subpages and shows only own images", async () => {
    const { result, onComment, requestSubpage } = features();

    expect(result.blockLink?.("ab12")).toBe(
      `${window.location.origin}/wiki/p1#block-ab12`,
    );
    result.comment?.();
    expect(onComment).toHaveBeenCalled();
    expect(await result.createPage?.()).toBeNull();
    expect(requestSubpage).toHaveBeenCalled();
    expect(result.isDisplayableImage("/wiki/attachments/a1")).toBe(true);
    expect(result.isDisplayableImage("https://example.com/x.png")).toBe(false);
  });

  it("uploads files to the page and links what was stored", async () => {
    const stored = (overrides: Partial<WikiAttachment>): WikiAttachment => ({
      contentType: "image/png",
      createdAt: "2026-01-02 10:00:00",
      fileName: "a.png",
      id: "a1",
      isEmbeddable: true,
      kind: "media",
      pageId: "p1",
      size: 1,
      uploadedBy: "o1",
      uploadedByName: "Olga",
      ...overrides,
    });
    const upload = vi.fn(async () => [
      stored({}),
      stored({ fileName: "b.pdf", id: "a2", isEmbeddable: false }),
    ]);
    const { result } = features(upload);

    expect(await result.uploadFiles?.([new File(["x"], "a.png")])).toEqual([
      { href: "/wiki/attachments/a1", isImage: true, name: "a.png" },
      { href: "/wiki/attachments/a2", isImage: false, name: "b.pdf" },
    ]);
  });

  it("finds references and stays quiet when the server cannot answer", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();

    vi.stubGlobal("fetch", fetch);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fetch.mockResolvedValueOnce(
      Response.json({
        references: [{ key: "PAG-1", kind: "ticket", title: "Bug" }],
      }),
    );

    const { result } = features();

    expect(await result.findReferences?.("pag 1")).toEqual([
      expect.objectContaining({ hint: "Ticket", key: "ticket:PAG-1" }),
    ]);
    expect(fetch).toHaveBeenCalledWith("/wiki-api/references?q=pag%201");

    fetch.mockResolvedValueOnce(new Response("", { status: 500 }));
    expect(await result.findReferences?.("x")).toEqual([]);
    fetch.mockRejectedValueOnce(new TypeError("offline"));
    expect(await result.findReferences?.("x")).toEqual([]);
    expect(console.warn).toHaveBeenCalled();
  });
});
