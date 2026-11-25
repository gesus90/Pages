import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createEmbeddingModelFactory,
  DEFAULT_LOCAL_MODEL_ID,
  DeterministicEmbeddingModel,
  EmbeddingModelChangedError,
  LocalEmbeddingModel,
  readSearchEmbeddingModel,
} from "./EmbeddingModels";

const logEvent = vi.hoisted(() => vi.fn());

vi.mock("@/backend/logging/Logger", () => ({ logEvent }));

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  const response: Pick<Response, "ok" | "status" | "json"> = {
    ok,
    status,
    json: () => Promise.resolve(body),
  };
  return response as Response;
}

function serve(...answers: Response[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn();
  for (const answer of answers) fetchMock.mockResolvedValueOnce(answer);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const INFO = { model_id: DEFAULT_LOCAL_MODEL_ID, model_sha: "abc" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  logEvent.mockReset();
});

describe("DeterministicEmbeddingModel", () => {
  it("rejects too few dimensions", () => {
    expect(() => new DeterministicEmbeddingModel(1)).toThrow(RangeError);
    expect(() => new DeterministicEmbeddingModel(2.5)).toThrow(RangeError);
  });

  it("names the version with its dimensions", async () => {
    await expect(
      new DeterministicEmbeddingModel().resolveVersion(),
    ).resolves.toBe("pages/deterministic-word-hash@1-d64");
  });

  it("embeds equal texts equally and falls back for empty texts", async () => {
    const model = new DeterministicEmbeddingModel(8);
    const [a, b, empty] = await model.embed(["Hallo Welt", "hallo welt", ""]);
    expect(a).toEqual(b);
    expect(empty).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(Math.hypot(...(a ?? []))).toBeCloseTo(1);
  });

  it("gives words that cancel out a direction", async () => {
    const model = new DeterministicEmbeddingModel(2);
    const words = Array.from({ length: 40 }, (_, index) => `w${String(index)}`);
    const [vector] = await model.embed([words.join(" ")]);
    expect(Math.hypot(...(vector ?? []))).toBeCloseTo(1);
  });
});

describe("LocalEmbeddingModel", () => {
  it("rejects addresses off this machine or without http", () => {
    expect(
      () => new LocalEmbeddingModel({ baseUrl: "ftp://127.0.0.1" }),
    ).toThrow("http or https");
    expect(
      () => new LocalEmbeddingModel({ baseUrl: "http://example.com" }),
    ).toThrow("on this machine");
  });

  it("resolves and pins the version", async () => {
    const fetchMock = serve(jsonResponse(INFO), jsonResponse(INFO));
    const model = new LocalEmbeddingModel({ baseUrl: "http://localhost:8080" });
    await expect(model.resolveVersion()).resolves.toBe("BAAI/bge-m3@abc");
    await expect(model.resolveVersion()).resolves.toBe("BAAI/bge-m3@abc");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops when the pinned version changes", async () => {
    serve(jsonResponse(INFO), jsonResponse({ ...INFO, model_sha: "def" }));
    const model = new LocalEmbeddingModel({ baseUrl: "http://localhost:8080" });
    await model.resolveVersion();
    await expect(model.resolveVersion()).rejects.toBeInstanceOf(
      EmbeddingModelChangedError,
    );
  });
});

describe("LocalEmbeddingModel batches", () => {
  it("embeds in batches", async () => {
    const texts = Array.from({ length: 17 }, (_, index) => String(index));
    const fetchMock = serve(
      jsonResponse(INFO),
      jsonResponse(texts.slice(0, 16).map(() => [1])),
      jsonResponse(INFO),
      jsonResponse([[2]]),
      jsonResponse(INFO),
    );
    const model = new LocalEmbeddingModel({ baseUrl: "http://[::1]:8080" });
    const vectors = await model.embed(texts);
    expect(vectors).toHaveLength(17);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
  });

  it("uses the pinned version without resolving again", async () => {
    serve(jsonResponse(INFO), jsonResponse([[1]]), jsonResponse(INFO));
    const model = new LocalEmbeddingModel({ baseUrl: "http://127.0.0.1" });
    await model.resolveVersion();
    await expect(model.embed(["a"])).resolves.toEqual([[1]]);
  });

  it("stops embedding when the revision changed in between", async () => {
    serve(
      jsonResponse(INFO),
      jsonResponse([[1]]),
      jsonResponse({ ...INFO, model_sha: "zzz" }),
    );
    const model = new LocalEmbeddingModel({ baseUrl: "http://127.0.0.1" });
    await expect(model.embed(["a"])).rejects.toBeInstanceOf(
      EmbeddingModelChangedError,
    );
  });

  it("rejects a wrong vector count and invalid vectors", async () => {
    serve(jsonResponse(INFO), jsonResponse([[1], [2]]));
    const model = new LocalEmbeddingModel({ baseUrl: "http://127.0.0.1" });
    await expect(model.embed(["a"])).rejects.toThrow("wrong number");
    serve(jsonResponse(INFO), jsonResponse(["x"]));
    await expect(
      new LocalEmbeddingModel({ baseUrl: "http://127.0.0.1" }).embed(["a"]),
    ).rejects.toThrow("invalid vector");
    serve(jsonResponse(INFO), jsonResponse({}));
    await expect(
      new LocalEmbeddingModel({ baseUrl: "http://127.0.0.1" }).embed(["a"]),
    ).rejects.toThrow("wrong number");
    serve(jsonResponse(INFO), jsonResponse([[]]));
    await expect(
      new LocalEmbeddingModel({ baseUrl: "http://127.0.0.1" }).embed(["a"]),
    ).rejects.toThrow("invalid vector");
    serve(jsonResponse(INFO), jsonResponse([["x"]]));
    await expect(
      new LocalEmbeddingModel({ baseUrl: "http://127.0.0.1" }).embed(["a"]),
    ).rejects.toThrow("invalid vector");
  });
});

describe("LocalEmbeddingModel server answers", () => {
  it("rejects bad /info answers", async () => {
    const make = (): LocalEmbeddingModel =>
      new LocalEmbeddingModel({ baseUrl: "http://127.0.0.1" });
    serve(jsonResponse(null));
    await expect(make().resolveVersion()).rejects.toThrow("without model_id");
    serve(jsonResponse({}));
    await expect(make().resolveVersion()).rejects.toThrow("without model_id");
    serve(jsonResponse({ model_id: 3 }));
    await expect(make().resolveVersion()).rejects.toThrow("invalid model_id");
    serve(jsonResponse({ model_id: "other", model_sha: "a" }));
    await expect(make().resolveVersion()).rejects.toThrow("instead of");
    serve(jsonResponse({ model_id: DEFAULT_LOCAL_MODEL_ID }));
    await expect(make().resolveVersion()).rejects.toThrow("no model revision");
    serve(jsonResponse({ model_id: DEFAULT_LOCAL_MODEL_ID, model_sha: "" }));
    await expect(make().resolveVersion()).rejects.toThrow("no model revision");
    serve(jsonResponse(INFO, false, 500));
    await expect(make().resolveVersion()).rejects.toThrow("status 500");
  });

  it("checks the expected revision", async () => {
    serve(jsonResponse(INFO));
    await expect(
      new LocalEmbeddingModel({
        baseUrl: "http://127.0.0.1",
        revision: "other",
      }).resolveVersion(),
    ).rejects.toThrow("revision abc instead of other");
    serve(jsonResponse({ model_id: DEFAULT_LOCAL_MODEL_ID }));
    await expect(
      new LocalEmbeddingModel({
        baseUrl: "http://127.0.0.1",
        revision: "pinned",
        modelId: DEFAULT_LOCAL_MODEL_ID,
      }).resolveVersion(),
    ).resolves.toBe("BAAI/bge-m3@pinned");
    serve(jsonResponse(INFO));
    await expect(
      new LocalEmbeddingModel({
        baseUrl: "http://127.0.0.1",
        revision: "abc",
      }).resolveVersion(),
    ).resolves.toBe("BAAI/bge-m3@abc");
  });
});

describe("createEmbeddingModelFactory", () => {
  it("returns null without a kind", () => {
    expect(createEmbeddingModelFactory({})).toBeNull();
    expect(
      createEmbeddingModelFactory({ PAGES_SEARCH_EMBEDDING: " " }),
    ).toBeNull();
  });

  it("builds the fake with optional dimensions", async () => {
    const plain = createEmbeddingModelFactory({
      PAGES_SEARCH_EMBEDDING: "fake",
    });
    await expect(plain?.().resolveVersion()).resolves.toContain("-d64");
    const sized = createEmbeddingModelFactory({
      PAGES_SEARCH_EMBEDDING: "fake",
      PAGES_SEARCH_EMBEDDING_DIMENSIONS: "8",
    });
    await expect(sized?.().resolveVersion()).resolves.toContain("-d8");
    const empty = createEmbeddingModelFactory({
      PAGES_SEARCH_EMBEDDING: "fake",
      PAGES_SEARCH_EMBEDDING_DIMENSIONS: "",
    });
    await expect(empty?.().resolveVersion()).resolves.toContain("-d64");
    expect(() =>
      createEmbeddingModelFactory({
        PAGES_SEARCH_EMBEDDING: "fake",
        PAGES_SEARCH_EMBEDDING_DIMENSIONS: "x",
      }),
    ).toThrow("whole number");
  });

  it("validates the local settings", () => {
    expect(() =>
      createEmbeddingModelFactory({ PAGES_SEARCH_EMBEDDING: "x" }),
    ).toThrow("local or fake");
    expect(() =>
      createEmbeddingModelFactory({ PAGES_SEARCH_EMBEDDING: "local" }),
    ).toThrow("needs PAGES_SEARCH_EMBEDDING_URL");
    const factory = createEmbeddingModelFactory({
      PAGES_SEARCH_EMBEDDING: "local",
      PAGES_SEARCH_EMBEDDING_URL: "http://localhost:1",
      PAGES_SEARCH_EMBEDDING_MODEL_ID: " ",
      PAGES_SEARCH_EMBEDDING_REVISION: "r",
    });
    expect(factory?.()).toBeInstanceOf(LocalEmbeddingModel);
  });
});

describe("readSearchEmbeddingModel", () => {
  it("reads the process environment", () => {
    vi.stubEnv("PAGES_SEARCH_EMBEDDING", "fake");
    expect(readSearchEmbeddingModel()).not.toBeNull();
  });

  it("logs an invalid configuration and returns null", () => {
    vi.stubEnv("PAGES_SEARCH_EMBEDDING", "bogus");
    expect(readSearchEmbeddingModel()).toBeNull();
    expect(logEvent).toHaveBeenCalledOnce();
  });
});
