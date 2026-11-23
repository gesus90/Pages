import { expect, it, vi } from "vitest";

import {
  InvalidEmbeddingError,
  SearchEmbeddingRepository,
  VectorSearchUnavailableError,
} from "./SearchEmbeddingRepository";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { ExactSearchRequest } from "./SearchEmbeddingRepository";

interface Double {
  repository: SearchEmbeddingRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
}

function doubleOf(...answers: (DatabaseValue[][] | Error)[]): Double {
  const query = vi.fn();
  for (const answer of answers)
    if (answer instanceof Error) query.mockRejectedValueOnce(answer);
    else query.mockResolvedValueOnce(answer);
  const execute = vi.fn(async () => undefined);
  const database = {
    query,
    transaction: async (work: (transaction: unknown) => Promise<unknown>) =>
      work({ execute }),
  } as unknown as Database;
  return {
    repository: new SearchEmbeddingRepository(database),
    query,
    execute,
  };
}

function requestOf(
  overrides: Partial<ExactSearchRequest> = {},
): ExactSearchRequest {
  return {
    modelVersion: "m1",
    embedding: [1, 0],
    visibleSources: { sql: "SELECT 1", parameters: { who: "u" } },
    limit: 5,
    ...overrides,
  };
}

const SOURCE = {
  sourceType: "ticket",
  sourceId: "t1",
  sourceVersion: "v1",
} as const;
const SECTIONS = [
  { sectionIndex: 0, sectionText: "a", embedding: [0.5, -1] },
  { sectionIndex: 1, sectionText: "b", embedding: [1, 2] },
];
const INSTALLED: DatabaseValue[][] = [[1, "0.8.0"]];

it("reports the vector support", async () => {
  const installed = doubleOf(INSTALLED);
  const absent = doubleOf([[0, null]]);
  const empty = doubleOf([]);

  await expect(installed.repository.readVectorSupport()).resolves.toEqual({
    isAvailable: true,
    isInstalled: true,
    installedVersion: "0.8.0",
  });
  await expect(absent.repository.readVectorSupport()).resolves.toEqual({
    isAvailable: false,
    isInstalled: false,
    installedVersion: null,
  });
  await expect(empty.repository.readVectorSupport()).rejects.toThrow();
});

it("replaces the sections of a source", async () => {
  const { repository, execute } = doubleOf();

  await repository.replaceSourceSections(SOURCE, "m1", SECTIONS);

  expect(execute).toHaveBeenCalledTimes(3);
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    section_index: 0,
    dimensions: 2,
    embedding: "{0.5,-1}",
  });
});

it("rejects invalid vectors before writing", async () => {
  const { repository, execute } = doubleOf();
  const write = async (embedding: number[]): Promise<void> =>
    repository.replaceSourceSections(SOURCE, "m1", [
      { sectionIndex: 0, sectionText: "a", embedding },
    ]);

  await expect(write([])).rejects.toBeInstanceOf(InvalidEmbeddingError);
  await expect(write(new Array<number>(16001).fill(1))).rejects.toThrow(
    "1 to 16000",
  );
  await expect(write([1, Number.NaN])).rejects.toThrow("finite");
  await expect(write([1e300])).rejects.toThrow("finite");
  await expect(write([0, 0])).rejects.toThrow("zero vector");
  expect(execute).not.toHaveBeenCalled();
});

it("replaces an indexed source with its record", async () => {
  const { repository, execute } = doubleOf();

  await repository.replaceIndexedSource(
    { ...SOURCE, modelVersion: "m1", fingerprint: "f" },
    SECTIONS,
  );

  expect(execute).toHaveBeenCalledTimes(4);
  expect(execute.mock.calls[3]?.[1]).toMatchObject({
    fingerprint: "f",
    section_count: 2,
  });
});

it("lists indexed sources", async () => {
  const { repository } = doubleOf([["wiki_page", "w1", "v2", "fp", 3]]);

  await expect(repository.listIndexedSources("m1")).resolves.toEqual([
    {
      sourceType: "wiki_page",
      sourceId: "w1",
      sourceVersion: "v2",
      fingerprint: "fp",
      sectionCount: 3,
    },
  ]);
});

it("rejects an unknown source type", async () => {
  const { repository } = doubleOf([["note", "n1"]]);

  await expect(repository.listStoredSourceKeys()).rejects.toThrow(
    "source_type",
  );
});

it("lists the stored source keys", async () => {
  const { repository } = doubleOf([["ticket_asset", "a1"]]);

  await expect(repository.listStoredSourceKeys()).resolves.toEqual([
    { sourceType: "ticket_asset", sourceId: "a1" },
  ]);
});

it("removes a source and a model inventory", async () => {
  const { repository, execute } = doubleOf();

  await repository.removeSource("ticket", "t1");
  await repository.removeModelInventory("m1");

  expect(execute).toHaveBeenCalledTimes(4);
  expect(execute.mock.calls[3]?.[1]).toEqual({ model_version: "m1" });
});

it("finds the nearest sections", async () => {
  const { repository, query } = doubleOf(INSTALLED, [
    ["ticket", "t1", "v1", 0, "text", 0.25],
  ]);

  await expect(repository.searchExact(requestOf())).resolves.toEqual([
    {
      sourceType: "ticket",
      sourceId: "t1",
      sourceVersion: "v1",
      sectionIndex: 0,
      sectionText: "text",
      cosineDistance: 0.25,
    },
  ]);
  expect(query.mock.calls[1]?.[1]).toEqual({
    who: "u",
    model_version: "m1",
    dimensions: 2,
    query_embedding: "{1,0}",
    limit: 5,
  });
});

it("refuses a visibility query that reuses a search placeholder", async () => {
  const { repository, query } = doubleOf();

  await expect(
    repository.searchExact(
      requestOf({ visibleSources: { sql: "x", parameters: { limit: 1 } } }),
    ),
  ).rejects.toThrow("reuses search placeholders: limit");
  expect(query).not.toHaveBeenCalled();
});

it("reports missing pgvector before the search", async () => {
  const { repository } = doubleOf([[1, null]]);

  await expect(repository.searchExact(requestOf())).rejects.toBeInstanceOf(
    VectorSearchUnavailableError,
  );
});

it("maps a missing vector type during the search", async () => {
  const missing = Object.assign(new Error("no type"), { code: "42704" });
  const { repository } = doubleOf(INSTALLED, missing);

  await expect(repository.searchExact(requestOf())).rejects.toBeInstanceOf(
    VectorSearchUnavailableError,
  );
});

it("passes other search errors on", async () => {
  const coded = Object.assign(new Error("syntax"), { code: "42601" });
  const plain = new Error("down");

  await expect(
    doubleOf(INSTALLED, coded).repository.searchExact(requestOf()),
  ).rejects.toBe(coded);
  await expect(
    doubleOf(INSTALLED, plain).repository.searchExact(requestOf()),
  ).rejects.toBe(plain);
});

it("rejects a hit without a numeric distance", async () => {
  const { repository } = doubleOf(INSTALLED, [
    ["ticket", "t1", "v1", 0, "text", "x"],
  ]);

  await expect(repository.searchExact(requestOf())).rejects.toThrow(
    "cosine_distance",
  );
  const nan = doubleOf(INSTALLED, [["ticket", "t1", "v1", 0, "t", Number.NaN]]);
  await expect(nan.repository.searchExact(requestOf())).rejects.toThrow(
    "cosine_distance",
  );
});
