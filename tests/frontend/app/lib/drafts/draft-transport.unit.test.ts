import { describe, expect, it, vi } from "vitest";

import {
  descriptionDraftAdapter,
  wikiDraftAdapter,
} from "@/app/lib/drafts/draft-transport";
import { WIKI_LIMITS } from "@/definition/Wiki";

import type { DraftEntry } from "@/app/lib/drafts/draft-queue";
import type {
  DescriptionContent,
  WikiSaveContent,
} from "@/definition/BackgroundSave";

const WIKI: WikiSaveContent = {
  title: "Roadmap",
  content: "Body",
  icon: null,
  revision: 3,
};
const DESCRIPTION: DescriptionContent = {
  description: "Text",
  updatedAt: "2026-01-01 00:00:00",
};

function entry<T>(id: string, value: T): DraftEntry<T> {
  return {
    id,
    href: `/${id}`,
    label: id,
    streamId: "stream-1",
    sequence: 4,
    base: value,
    draft: value,
    error: null,
    isSaving: false,
    hasChanges: false,
    hasEdited: false,
    hasUnconfirmedWrite: false,
  };
}

function answer(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

describe("the wiki draft adapter", () => {
  it("treats titles that differ only in whitespace as equal", () => {
    expect(wikiDraftAdapter.equal(WIKI, { ...WIKI, title: "  Roadmap " })).toBe(
      true,
    );
    expect(wikiDraftAdapter.equal(WIKI, { ...WIKI, content: "Other" })).toBe(
      false,
    );
    expect(wikiDraftAdapter.equal(WIKI, { ...WIKI, icon: "🗺" })).toBe(false);
    expect(wikiDraftAdapter.delay).toBe(1200);
  });

  it("validates the title and the size of the page", () => {
    expect(wikiDraftAdapter.validate(WIKI)).toBeNull();
    expect(wikiDraftAdapter.validate({ ...WIKI, title: "  " })).toBe(
      "titleRequired",
    );
    expect(
      wikiDraftAdapter.validate({
        ...WIKI,
        title: "x".repeat(WIKI_LIMITS.titleLength + 1),
      }),
    ).toBe("tooLong");
    expect(
      wikiDraftAdapter.validate({
        ...WIKI,
        content: "x".repeat(WIKI_LIMITS.contentLength + 1),
      }),
    ).toBe("tooLong");
    expect(
      wikiDraftAdapter.validate({
        ...WIKI,
        content: "x".repeat(WIKI_LIMITS.contentLength),
      }),
    ).toBeNull();
  });

  it("posts the draft with its stream and sequence and returns the confirmed page", async () => {
    answer(200, { ok: true, saved: { ...WIKI, revision: 4 } });

    const result = await wikiDraftAdapter.save(entry("page-1", WIKI));

    expect(result).toEqual({ ok: true, saved: { ...WIKI, revision: 4 } });
    const [address, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(address).toBe("/wiki-api/drafts/page-1");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      base: WIKI,
      draft: WIKI,
      streamId: "stream-1",
      sequence: 4,
    });
  });

  it("returns a conflict with the current page", async () => {
    answer(409, { ok: false, error: "conflict", current: WIKI });

    await expect(wikiDraftAdapter.save(entry("page-1", WIKI))).resolves.toEqual(
      {
        ok: false,
        error: "conflict",
        current: WIKI,
      },
    );
  });

  it("reports a server error without reading the body", async () => {
    answer(503, "unavailable");

    await expect(wikiDraftAdapter.save(entry("page-1", WIKI))).resolves.toEqual(
      {
        ok: false,
        error: "backend",
      },
    );
  });

  it("refuses a success answer behind a failing status", async () => {
    answer(400, { ok: true, saved: WIKI });

    await expect(wikiDraftAdapter.save(entry("page-1", WIKI))).rejects.toThrow(
      "Unconfirmed draft response.",
    );
  });
});

describe("the ticket description adapter", () => {
  it("compares the trimmed text and has no automatic save", () => {
    expect(
      descriptionDraftAdapter.equal(DESCRIPTION, {
        ...DESCRIPTION,
        description: " Text ",
      }),
    ).toBe(true);
    expect(
      descriptionDraftAdapter.equal(DESCRIPTION, {
        ...DESCRIPTION,
        description: "Other",
      }),
    ).toBe(false);
    expect(descriptionDraftAdapter.delay).toBeNull();
  });

  it("validates the length of the description", () => {
    expect(descriptionDraftAdapter.validate(DESCRIPTION)).toBeNull();
    expect(
      descriptionDraftAdapter.validate({
        ...DESCRIPTION,
        description: "x".repeat(65_537),
      }),
    ).toBe("descriptionTooLong");
  });

  it("posts to the ticket draft address", async () => {
    answer(200, { ok: true, saved: DESCRIPTION });

    const result = await descriptionDraftAdapter.save(
      entry("ticket-1", DESCRIPTION),
    );

    expect(result).toEqual({ ok: true, saved: DESCRIPTION });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      "/ticket-api/drafts/ticket-1",
    );
  });
});
