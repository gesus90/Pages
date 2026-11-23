import { describe, expect, it, vi } from "vitest";

import { CatalogProviderClient } from "@/backend/agents/catalog/CatalogProviderClient";
import { AgentError } from "@/backend/error/AgentErrors";

import type { CatalogHttpClient } from "@/backend/agents/catalog/CatalogHttpClient";
import type { AgentCatalogModel } from "@/definition/AgentModelCatalog";

type Payload = Record<string, unknown>;

function clientReturning(pages: readonly Payload[]): {
  client: CatalogProviderClient;
  paths: string[];
} {
  const paths: string[] = [];
  const queue = [...pages];
  const http = {
    get: vi.fn((input: { path: string }) => {
      paths.push(input.path);
      return Promise.resolve({ payload: queue.shift(), bytes: 10 });
    }),
  } as unknown as CatalogHttpClient;
  return { client: new CatalogProviderClient(http), paths };
}

const signal = new AbortController().signal;

function chat(id: string): Payload {
  return {
    id,
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  };
}

async function codeOf(promise: Promise<unknown>): Promise<unknown> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  return error instanceof AgentError ? error.code : error;
}

describe("CatalogProviderClient.list", () => {
  it("rejects a provider without a catalog", async () => {
    const { client } = clientReturning([]);
    expect(await codeOf(client.list("nope" as "openai", "k", signal))).toBe(
      "catalog_unsupported",
    );
  });

  it("lists a plain provider sorted by ID", async () => {
    const { client, paths } = clientReturning([
      { data: [{ id: "b" }, { id: "a" }] },
    ]);
    const models = await client.list("openai", "k", signal);
    expect(models.map((model) => model.id)).toEqual(["a", "b"]);
    expect(paths).toEqual(["/models"]);
  });

  it("keeps the order of Anthropic and follows its cursor", async () => {
    const { client, paths } = clientReturning([
      { data: [{ id: "z" }], has_more: true, last_id: "a/b" },
      { data: [{ id: "y" }], has_more: false },
    ]);
    const models = await client.list("anthropic", "k", signal);
    expect(models.map((model) => model.id)).toEqual(["z", "y"]);
    expect(paths).toEqual([
      "/models?limit=1000",
      "/models?limit=1000&after_id=a%2Fb",
    ]);
  });

  it("follows the Google page tokens", async () => {
    const generate = ["generateContent"];
    const { client, paths } = clientReturning([
      {
        models: [{ name: "models/a", supportedGenerationMethods: generate }],
        nextPageToken: "t 1",
      },
      { models: [{ name: "models/b", supportedGenerationMethods: generate }] },
    ]);
    await client.list("google_ai_studio", "k", signal);
    expect(paths).toEqual([
      "/models?pageSize=1000",
      "/models?pageSize=1000&pageToken=t%201",
    ]);
  });

  it("follows the OpenRouter offsets", async () => {
    const { client, paths } = clientReturning([
      { data: [chat("v/a")], total_count: 2 },
      { data: [chat("v/b")], total_count: 2 },
    ]);
    const models = await client.list("openrouter", "k", signal);
    expect(models).toHaveLength(2);
    expect(paths).toEqual([
      "/models?output_modalities=text&limit=1000&offset=0",
      "/models?output_modalities=text&limit=1000&offset=1",
    ]);
  });

  it("rejects a repeated cursor", async () => {
    const page = { data: [{ id: "a" }], has_more: true, last_id: "same" };
    const { client } = clientReturning([page, page, page]);
    expect(await codeOf(client.list("anthropic", "k", signal))).toBe(
      "provider_bad_response",
    );
  });

  it("rejects a catalog of too many pages", async () => {
    const pages = Array.from({ length: 33 }, (_, index) => ({
      data: [{ id: `m${index}` }],
      has_more: true,
      last_id: `c${index}`,
    }));
    const { client } = clientReturning(pages);
    expect(await codeOf(client.list("anthropic", "k", signal))).toBe(
      "catalog_limit_exceeded",
    );
  });

  it("rejects a catalog of too many models", async () => {
    const big = Array.from({ length: 10_000 }, (_, index) => ({
      id: `m${index}`,
    }));
    const { client } = clientReturning([
      { data: big, has_more: true, last_id: "n" },
      { data: [{ id: "extra" }], has_more: false },
    ]);
    expect(await codeOf(client.list("anthropic", "k", signal))).toBe(
      "catalog_limit_exceeded",
    );
  });

  it("builds its own HTTP client by default", () => {
    expect(new CatalogProviderClient()).toBeInstanceOf(CatalogProviderClient);
  });
});

describe("CatalogProviderClient add listings", () => {
  const existing: AgentCatalogModel = {
    id: "v/a",
    name: "kept",
    contextWindow: null,
    promptPrice: null,
    completionPrice: null,
    isFree: false,
    reasoning: "unknown",
    reasoningEfforts: [],
    defaultReasoningEffort: null,
  };
  const listing = (id: string): Payload => ({
    data: [
      {
        id,
        name: "listed",
        architecture: {
          input_modalities: ["audio"],
          output_modalities: ["transcription"],
        },
      },
    ],
  });

  it.each([
    ["addTranscriptionModels", "transcription"],
    ["addSpeechOutputModels", "speech"],
    ["addDecisionModels", "decisions"],
  ] as const)("%s merges a separate listing", async (method, modality) => {
    const speakable = {
      data: [
        {
          id: "v/b",
          architecture: {
            input_modalities: ["text", "audio"],
            output_modalities: [modality],
          },
        },
        {
          id: "v/a",
          architecture: {
            input_modalities: ["text", "audio"],
            output_modalities: [modality],
          },
        },
      ],
    };
    const { client, paths } = clientReturning([speakable]);
    const models = await client[method]([existing], "k", signal);
    expect(models.map((model) => [model.id, model.name])).toEqual([
      ["v/a", "kept"],
      ["v/b", "v/b"],
    ]);
    expect(paths[0]).toContain(`output_modalities=${modality}`);
  });

  it("rejects a merged catalog that grows too large", async () => {
    const crowded = Array.from({ length: 10_000 }, (_, index) => ({
      ...existing,
      id: `v/${index}`,
    }));
    const { client } = clientReturning([listing("w/new")]);
    expect(
      await codeOf(client.addTranscriptionModels(crowded, "k", signal)),
    ).toBe("catalog_limit_exceeded");
  });
});
