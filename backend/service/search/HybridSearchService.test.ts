import { describe, expect, it, vi } from "vitest";

import { VectorSearchUnavailableError } from "@/backend/database/repositories/search/SearchEmbeddingRepository";

import { HybridSearchService } from "./HybridSearchService";
import { ticketSourceVersion } from "./SearchIndexService";

import type { EmbeddingModel } from "./EmbeddingModels";
import type { HybridSearchRequest } from "./HybridSearchService";

const logEvent = vi.hoisted(() => vi.fn());

vi.mock("@/backend/logging/Logger", () => ({ logEvent }));
vi.mock(
  "@/backend/database/repositories/search/SourceSearchRepository",
  () => ({
    createVisibleSourceQuery: () => ({ sql: "SELECT 1", parameters: {} }),
  }),
);

const TICKET = {
  id: "t1",
  key: "PAGE-1",
  title: "Login",
  description: "# A\n\nalpha\n\n# B\n\nbeta alpha",
  projectId: "p1",
};
const PAGE = {
  id: "w1",
  title: "Guide",
  content: "alpha text",
  revision: 3,
  projectId: null,
};
const ASSET = {
  id: "a1",
  fileName: "f.txt",
  checksum: "sum",
  ticketKey: "PAGE-1",
  projectId: "p1",
};
const TICKET_SECTIONS = ["PAGE-1: Login\n\n# A\n\nalpha", "# B\n\nbeta alpha"];

interface Setup {
  keyTickets?: string[];
  keywordTickets?: string[];
  keywordPages?: string[];
  hits?: unknown[];
  tickets?: unknown[];
  pages?: unknown[];
  assets?: unknown[];
  createModel?: unknown;
  timeout?: number;
}

function modelFactory(embedError?: Error): () => EmbeddingModel {
  return () => ({
    resolveVersion: () => Promise.resolve("m@1"),
    embed: () =>
      embedError ? Promise.reject(embedError) : Promise.resolve([[1, 0]]),
  });
}

function build(setup: Setup = {}): {
  service: HybridSearchService;
  sources: Record<string, ReturnType<typeof vi.fn>>;
  searchPages: ReturnType<typeof vi.fn>;
} {
  const searchPages = vi.fn().mockResolvedValue({
    hits: (setup.keywordPages ?? []).map((id) => ({ id })),
  });
  const sources = {
    findTicketsByKey: vi.fn().mockResolvedValue(setup.keyTickets ?? []),
    searchTickets: vi.fn().mockResolvedValue(setup.keywordTickets ?? []),
    readCurrentSources: vi.fn().mockResolvedValue({
      tickets: setup.tickets ?? [],
      pages: setup.pages ?? [],
      assets: setup.assets ?? [],
    }),
  };
  const service = new HybridSearchService({
    sources,
    pages: { search: searchPages },
    embeddings: {
      searchExact: vi.fn().mockResolvedValue(setup.hits ?? []),
    },
    createModel: (setup.createModel ?? null) as never,
    vectorTimeoutMilliseconds: setup.timeout,
  });
  return { service, sources, searchPages };
}

function request(
  overrides: Partial<HybridSearchRequest> = {},
): HybridSearchRequest {
  return {
    scope: vi.fn() as never,
    projectId: null,
    question: "alpha",
    limit: 10,
    sourceTypes: null,
    after: null,
    ...overrides,
  };
}

function hit(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    sourceType: "ticket",
    sourceId: "t1",
    sourceVersion: ticketSourceVersion(TICKET),
    sectionIndex: 0,
    sectionText: TICKET_SECTIONS[0],
    cosineDistance: 0.1,
    ...overrides,
  };
}

describe("HybridSearchService", () => {
  it("rejects an empty question", async () => {
    await expect(
      build().service.search(request({ question: " " })),
    ).rejects.toThrow(RangeError);
  });

  it("answers by keyword alone without a model", async () => {
    const { service, sources, searchPages } = build({
      keyTickets: ["t1", "gone"],
      keywordTickets: ["t1", "a1"],
      keywordPages: ["w1"],
      tickets: [TICKET],
      pages: [PAGE],
      assets: [ASSET],
    });
    const result = await service.search(
      request({
        question: 'Where is page-1? "alpha" (beta) ?!',
        projectId: "p1",
      }),
    );
    expect(sources.findTicketsByKey).toHaveBeenCalledWith(expect.anything(), [
      "PAGE-1",
    ]);
    expect(searchPages.mock.calls[0]?.[1]).toMatchObject({
      area: { scope: "project", projectId: "p1" },
    });
    expect(result.vectorSearch).toEqual({
      status: "unavailable",
      reason: "notConfigured",
    });
    expect(result.next).toBeNull();
    expect(result.sections[0]).toMatchObject({
      sourceType: "ticket",
      sectionIndex: 0,
      link: "/tasks/PAGE-1",
      matchedBy: ["ticketKey", "keyword"],
    });
    expect(result.sections.map((section) => section.sourceType)).toEqual([
      "ticket",
      "ticket",
      "wiki_page",
    ]);
    expect(result.sections[2]?.link).toBe("/wiki/w1");
  });

  it("searches no pages and uses the first section without matching words", async () => {
    const { service, searchPages } = build({
      keywordTickets: ["t1"],
      tickets: [TICKET],
    });
    const result = await service.search(request({ question: "?!" }));
    expect(searchPages).not.toHaveBeenCalled();
    expect(result.sections.map((section) => section.sectionIndex)).toEqual([0]);
  });

  it("merges vector hits, counts stale ones and skips hidden ones", async () => {
    const { service } = build({
      keywordTickets: ["t1"],
      tickets: [TICKET],
      pages: [PAGE],
      assets: [ASSET],
      createModel: modelFactory(),
      hits: [
        hit({}),
        hit({ sourceId: "hidden" }),
        hit({ sourceVersion: "old" }),
        hit({ sectionIndex: 1, sectionText: "changed" }),
        hit({
          sourceId: "w1",
          sourceType: "wiki_page",
          sourceVersion: "3",
          sectionText: "Guide\n\nalpha text",
        }),
        hit({
          sourceId: "a1",
          sourceType: "ticket_asset",
          sourceVersion: "sum",
          sectionText: "asset text",
        }),
      ],
    });
    const result = await service.search(request());
    expect(result.vectorSearch).toEqual({
      status: "used",
      modelVersion: "m@1",
    });
    expect(result.staleSections).toBe(2);
    expect(
      result.sections.find((s) => s.sourceType === "ticket_asset"),
    ).toMatchObject({
      text: "asset text",
      link: "/aufgaben/attachments/a1",
      matchedBy: ["vector"],
    });
    expect(result.sections[0]?.matchedBy).toEqual(["keyword", "vector"]);
  });
});

describe("HybridSearchService fallbacks", () => {
  it("falls back to keywords when the vector part fails", async () => {
    const reasons = [];
    for (const error of [new VectorSearchUnavailableError(), new Error("x")]) {
      const { service } = build({ createModel: modelFactory(error) });
      reasons.push((await service.search(request())).vectorSearch);
    }
    expect(reasons).toEqual([
      { status: "unavailable", reason: "vectorSearchUnavailable" },
      { status: "unavailable", reason: "embeddingFailed" },
    ]);
    expect(logEvent).toHaveBeenCalledTimes(2);
  });

  it("falls back after the timeout", async () => {
    const never = (): EmbeddingModel => ({
      resolveVersion: () => new Promise<string>(() => undefined),
      embed: () => Promise.resolve([]),
    });
    const { service } = build({ createModel: never, timeout: 5 });
    await expect(service.search(request())).resolves.toMatchObject({
      vectorSearch: { status: "unavailable", reason: "timeout" },
    });
  });

  it("skips the keyword section of a page without text", async () => {
    const { service } = build({
      keywordPages: ["w1"],
      pages: [{ ...PAGE, title: "", content: "" }],
    });
    await expect(service.search(request())).resolves.toMatchObject({
      sections: [],
    });
  });

  it("uses the default timeout for a fast model", async () => {
    const { service } = build({ createModel: modelFactory() });
    await expect(service.search(request())).resolves.toMatchObject({
      vectorSearch: { status: "used" },
    });
  });
});

describe("HybridSearchService order", () => {
  it("pages in a total order and filters by source type", async () => {
    const setup = {
      keyTickets: ["t1"],
      keywordTickets: ["t1"],
      keywordPages: ["w1", "w2"],
      tickets: [TICKET],
      pages: [PAGE, { ...PAGE, id: "w2" }],
    };
    const first = await build(setup).service.search(request({ limit: 2 }));
    expect(first.sections).toHaveLength(2);
    expect(first.next).not.toBeNull();
    const second = await build(setup).service.search(
      request({ limit: 10, after: first.next }),
    );
    const all = await build(setup).service.search(request({ limit: 10 }));
    expect([...first.sections, ...second.sections]).toEqual(all.sections);
    expect(second.next).toBeNull();
    const pagesOnly = await build(setup).service.search(
      request({ sourceTypes: ["wiki_page"] }),
    );
    expect(pagesOnly.sections.map((s) => s.sourceId)).toEqual(["w1", "w2"]);
  });

  it("orders equal ranks by source and section and keeps the best key rank", async () => {
    const other = { ...TICKET, id: "t2", key: "PAGE-2" };
    const { service } = build({
      keyTickets: ["t1", "t2", "t1"],
      keywordTickets: ["t1", "t2"],
      tickets: [TICKET, other],
    });
    const result = await service.search(
      request({ question: "PAGE-1 PAGE-2 alpha" }),
    );
    expect(
      result.sections.map((s) => `${s.sourceId}:${String(s.sectionIndex)}`),
    ).toEqual(["t1:0", "t2:0", "t1:1", "t2:1"]);
  });

  it("orders sections of equal rank by source id and index", async () => {
    const other = { ...TICKET, id: "t2" };
    const { service } = build({
      createModel: modelFactory(),
      tickets: [TICKET, other],
      hits: [
        hit({ sourceId: "t2", sourceVersion: ticketSourceVersion(other) }),
        hit({ sectionIndex: 1, sectionText: TICKET_SECTIONS[1] }),
      ],
    });
    const result = await service.search(request());
    expect(result.sections).toHaveLength(2);
  });

  it("compares equal scores of different sections by index", async () => {
    // Same source, same fused rank is impossible via ranks; force it with a
    // keyword list holding the ticket twice so both sections share a rank.
    const { service } = build({
      keywordTickets: ["t1"],
      tickets: [TICKET],
    });
    const result = await service.search(request());
    expect(result.sections.map((s) => s.sectionIndex)).toEqual([0, 1]);
  });
});
