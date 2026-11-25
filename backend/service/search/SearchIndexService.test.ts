import { Readable } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  searchSimilarSections,
  SearchIndexService,
  splitIntoSections,
  ticketSourceVersion,
} from "./SearchIndexService";

import type {
  SearchIndexDependencies,
  SearchIndexRunReport,
  SearchQuestion,
} from "./SearchIndexService";
import type { EmbeddingModel } from "./EmbeddingModels";

const logEvent = vi.hoisted(() => vi.fn());

vi.mock("@/backend/logging/Logger", () => ({ logEvent }));

const TICKET = { id: "t1", key: "P-1", title: "Title", description: "Body" };

function stateOf(
  sourceType: "ticket" | "wiki_page" | "ticket_asset",
  sourceId: string,
  contentHash = "h",
): { sourceType: typeof sourceType; sourceId: string; contentHash: string } {
  return { sourceType, sourceId, contentHash };
}

function asset(
  contentType = "application/octet-stream",
): Record<string, string> {
  return { id: "a1", fileName: "n.txt", contentType, checksum: "sum" };
}

function opened(
  bytes: Buffer,
  size = bytes.length,
): { attachment: { size: number }; stream: Readable } {
  return { attachment: { size }, stream: Readable.from([bytes]) };
}

interface Fixture {
  readonly service: SearchIndexService;
  readonly dependencies: {
    embeddings: Record<string, ReturnType<typeof vi.fn>>;
    sources: Record<string, ReturnType<typeof vi.fn>>;
    assets: { openStored: ReturnType<typeof vi.fn> };
    model: {
      resolveVersion: ReturnType<typeof vi.fn>;
      embed: ReturnType<typeof vi.fn>;
    };
  };
}

function fixture(): Fixture {
  const dependencies = {
    embeddings: {
      listIndexedSources: vi.fn().mockResolvedValue([]),
      listStoredSourceKeys: vi.fn().mockResolvedValue([]),
      removeSource: vi.fn().mockResolvedValue(undefined),
      replaceIndexedSource: vi.fn().mockResolvedValue(undefined),
      removeModelInventory: vi.fn().mockResolvedValue(undefined),
      searchExact: vi.fn().mockResolvedValue([]),
    },
    sources: {
      listSourceStates: vi.fn().mockResolvedValue([]),
      readTicket: vi.fn().mockResolvedValue(TICKET),
      readWikiPage: vi
        .fn()
        .mockResolvedValue({ id: "w1", title: "T", content: "C", revision: 4 }),
      readReleasedAsset: vi.fn().mockResolvedValue(asset()),
    },
    assets: { openStored: vi.fn() },
    model: {
      resolveVersion: vi.fn().mockResolvedValue("m@1"),
      embed: vi.fn((texts: readonly string[]) =>
        Promise.resolve(texts.map(() => [1, 0])),
      ),
    },
  };
  return {
    dependencies,
    service: new SearchIndexService(
      dependencies as unknown as SearchIndexDependencies,
    ),
  };
}

async function runAsset(
  file: ReturnType<typeof opened> | null,
  contentType?: string,
): Promise<SearchIndexRunReport> {
  const { service, dependencies } = fixture();
  dependencies.sources.listSourceStates.mockResolvedValue([
    stateOf("ticket_asset", "a1"),
  ]);
  dependencies.sources.readReleasedAsset.mockResolvedValue(asset(contentType));
  dependencies.assets.openStored.mockResolvedValue(file);
  return service.runOnce();
}

beforeEach(() => {
  logEvent.mockReset();
});

describe("splitIntoSections", () => {
  it("keeps the title with the first heading's section", () => {
    expect(
      splitIntoSections("Title\n\n# Head\n\nText\n# Next\r\nMore"),
    ).toEqual(["Title\n\n# Head\n\nText", "# Next\nMore"]);
  });

  it("returns nothing for blank text", () => {
    expect(splitIntoSections(" \n\n ")).toEqual([]);
  });

  it("starts a new section when one is full", () => {
    const paragraph = "a".repeat(700);
    expect(splitIntoSections(`${paragraph}\n\n${paragraph}`)).toEqual([
      paragraph,
      paragraph,
    ]);
  });

  it("splits long paragraphs at sentence ends, spaces, and hard limits", () => {
    const sentence = `${"a".repeat(800)}. ${"b".repeat(700)}`;
    expect(splitIntoSections(sentence)).toEqual([
      `${"a".repeat(800)}.`,
      "b".repeat(700),
    ]);
    const spaced = `${"a".repeat(800)} ${"b".repeat(700)}`;
    expect(splitIntoSections(spaced)).toEqual([
      "a".repeat(800),
      "b".repeat(700),
    ]);
    const hard = `x. ${"y".repeat(1300)}`;
    expect(splitIntoSections(hard).join("").length).toBeGreaterThan(1300);
    const lone = splitIntoSections("z".repeat(1500));
    expect(lone).toEqual(["z".repeat(1200), "z".repeat(300)]);
  });

  it("does not split a surrogate pair", () => {
    const text = `${"q".repeat(1199)}😀${"q".repeat(10)}`;
    const [first] = splitIntoSections(text);
    expect(first).toBe("q".repeat(1199));
  });
});

describe("ticketSourceVersion", () => {
  it("hashes the ticket text", () => {
    expect(ticketSourceVersion(TICKET)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("searchSimilarSections", () => {
  const visibleSources: SearchQuestion["visibleSources"] = {
    sql: "SELECT 1",
    parameters: {},
  };
  const request: SearchQuestion = {
    question: " q ",
    visibleSources,
    limit: 3,
  };

  it("rejects an empty question", async () => {
    const { dependencies } = fixture();
    await expect(
      searchSimilarSections(
        dependencies.model as EmbeddingModel,
        dependencies.embeddings as never,
        { ...request, question: " " },
      ),
    ).rejects.toThrow(RangeError);
  });

  it("rejects a missing vector", async () => {
    const { dependencies } = fixture();
    dependencies.model.embed.mockResolvedValue([]);
    await expect(
      searchSimilarSections(
        dependencies.model as EmbeddingModel,
        dependencies.embeddings as never,
        request,
      ),
    ).rejects.toThrow("no vector");
  });

  it("searches with the embedded question", async () => {
    const { service, dependencies } = fixture();
    dependencies.embeddings.searchExact.mockResolvedValue(["hit"]);
    await expect(service.search(request)).resolves.toEqual({
      modelVersion: "m@1",
      hits: ["hit"],
    });
    expect(dependencies.embeddings.searchExact).toHaveBeenCalledWith(
      expect.objectContaining({
        modelVersion: "m@1",
        embedding: [1, 0],
        limit: 3,
      }),
    );
  });
});

describe("SearchIndexService.removeModelInventory", () => {
  it("refuses the current version and removes others", async () => {
    const { service, dependencies } = fixture();
    await expect(service.removeModelInventory("m@1")).rejects.toThrow("stays");
    await service.removeModelInventory("old");
    expect(dependencies.embeddings.removeModelInventory).toHaveBeenCalledWith(
      "old",
    );
  });
});

describe("SearchIndexService.runOnce", () => {
  it("removes vanished sources and keeps unchanged ones", async () => {
    const { service, dependencies } = fixture();
    dependencies.sources.listSourceStates.mockResolvedValue([
      stateOf("ticket", "t1", "same"),
    ]);
    dependencies.embeddings.listStoredSourceKeys.mockResolvedValue([
      { sourceType: "ticket", sourceId: "t1" },
      { sourceType: "wiki_page", sourceId: "gone" },
    ]);
    dependencies.embeddings.listIndexedSources.mockResolvedValue([
      { sourceType: "ticket", sourceId: "t1", fingerprint: "sections-v1:same" },
    ]);
    await expect(service.runOnce()).resolves.toEqual({
      modelVersion: "m@1",
      removedSources: 1,
      indexedSources: 0,
      unchangedSources: 1,
      writtenSections: 0,
      skippedAssets: 0,
    });
    expect(dependencies.embeddings.removeSource).toHaveBeenCalledWith(
      "wiki_page",
      "gone",
    );
  });
});

describe("SearchIndexService.runOnce sources", () => {
  it("indexes tickets and wiki pages", async () => {
    const { service, dependencies } = fixture();
    dependencies.sources.listSourceStates.mockResolvedValue([
      stateOf("ticket", "t1"),
      stateOf("wiki_page", "w1"),
    ]);
    const report = await service.runOnce();
    expect(report).toMatchObject({ indexedSources: 2, writtenSections: 2 });
    expect(dependencies.embeddings.replaceIndexedSource).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: "wiki_page", sourceVersion: "4" }),
      [{ sectionIndex: 0, sectionText: "T\n\nC", embedding: [1, 0] }],
    );
  });

  it("uses an empty vector when the model returns too few", async () => {
    const { service, dependencies } = fixture();
    dependencies.sources.listSourceStates.mockResolvedValue([
      stateOf("ticket", "t1"),
    ]);
    dependencies.model.embed.mockResolvedValue([]);
    await service.runOnce();
    expect(dependencies.embeddings.replaceIndexedSource).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({ embedding: [] })],
    );
  });

  it("removes sources deleted while indexing", async () => {
    const { service, dependencies } = fixture();
    dependencies.sources.listSourceStates.mockResolvedValue([
      stateOf("ticket", "t1"),
      stateOf("wiki_page", "w1"),
      stateOf("ticket_asset", "a1"),
    ]);
    dependencies.sources.readTicket.mockResolvedValue(null);
    dependencies.sources.readWikiPage.mockResolvedValue(null);
    dependencies.sources.readReleasedAsset.mockResolvedValue(null);
    await service.runOnce();
    expect(dependencies.embeddings.removeSource).toHaveBeenCalledTimes(3);
  });
});

describe("SearchIndexService.runOnce assets", () => {
  it("indexes text assets", async () => {
    await expect(runAsset(opened(Buffer.from("hello")))).resolves.toMatchObject(
      {
        indexedSources: 1,
        skippedAssets: 0,
        writtenSections: 1,
      },
    );
  });

  it("records binary and unreadable assets without sections", async () => {
    const skipped = { indexedSources: 1, skippedAssets: 1, writtenSections: 0 };
    await expect(runAsset(null, "image/png")).resolves.toMatchObject(skipped);
    await expect(runAsset(null)).resolves.toMatchObject(skipped);
    await expect(
      runAsset(opened(Buffer.from("x"), 2 * 1024 * 1024)),
    ).resolves.toMatchObject(skipped);
    await expect(
      runAsset(opened(Buffer.from([0xff, 0xfe]))),
    ).resolves.toMatchObject(skipped);
    await expect(
      runAsset(opened(Buffer.from("a\u0000b"))),
    ).resolves.toMatchObject(skipped);
    expect(logEvent).toHaveBeenCalledTimes(5);
  });

  it("rethrows other decoding errors", async () => {
    const decode = vi
      .spyOn(TextDecoder.prototype, "decode")
      .mockImplementation(() => {
        throw new Error("boom");
      });
    try {
      await expect(runAsset(opened(Buffer.from("x")))).rejects.toThrow("boom");
    } finally {
      decode.mockRestore();
    }
  });
});
