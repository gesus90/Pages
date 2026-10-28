import { afterEach, expect, it, vi } from "vitest";

import { CatalogHttpClient } from "@/backend/agents/catalog/CatalogHttpClient";
import { CatalogProviderClient } from "@/backend/agents/catalog/CatalogProviderClient";

import type { ApiProviderId } from "@/definition/AgentConnection";

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logEvent: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

const SIGNAL = new AbortController().signal;

/** Answers each catalog request with the next page and records the requested paths. */
function pages(...payloads: unknown[]): {
  readonly client: CatalogProviderClient;
  readonly urls: string[];
} {
  const urls: string[] = [];
  const request = vi.fn<typeof fetch>(async (url) => {
    urls.push(String(url));
    return Response.json(payloads[Math.min(urls.length, payloads.length) - 1]);
  });
  return {
    client: new CatalogProviderClient(new CatalogHttpClient(request)),
    urls,
  };
}

function openRouterModel(id: string): Record<string, unknown> {
  return {
    id,
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  };
}

it("refuses a provider without a model catalog", async () => {
  const { client, urls } = pages({});
  // An identifier from outside the typed catalog, as stored data could hold it.
  const stored: unknown = JSON.parse('"unknown-provider"');
  const provider = stored as ApiProviderId;

  await expect(client.list(provider, "key", SIGNAL)).rejects.toMatchObject({
    code: "catalog_unsupported",
  });
  expect(urls).toEqual([]);
});

it("follows OpenRouter offsets and sorts the models by identifier", async () => {
  const first = Array.from({ length: 2 }, (_, index) =>
    openRouterModel(`vendor/b-${index}`),
  );
  const { client, urls } = pages(
    { data: first, total_count: 3 },
    { data: [openRouterModel("vendor/a")], total_count: 3 },
  );

  const models = await client.list("openrouter", "key", SIGNAL);

  expect(models.map(({ id }) => id)).toEqual([
    "vendor/a",
    "vendor/b-0",
    "vendor/b-1",
  ]);
  expect(urls).toEqual([
    "https://openrouter.ai/api/v1/models?output_modalities=text&limit=1000&offset=0",
    "https://openrouter.ai/api/v1/models?output_modalities=text&limit=1000&offset=2",
  ]);
});

it("follows Google page tokens", async () => {
  const model = (name: string): Record<string, unknown> => ({
    name,
    supportedGenerationMethods: ["generateContent"],
  });
  const { client, urls } = pages(
    { models: [model("models/b")], nextPageToken: "next token" },
    { models: [model("models/a")] },
  );

  const models = await client.list("google_ai_studio", "key", SIGNAL);

  expect(models.map(({ id }) => id)).toEqual(["models/a", "models/b"]);
  expect(urls.map((url) => new URL(url).search)).toEqual([
    "?pageSize=1000",
    "?pageSize=1000&pageToken=next%20token",
  ]);
});

it("follows Anthropic cursors and keeps its newest-first order", async () => {
  const { client, urls } = pages(
    { data: [{ id: "claude-new" }], has_more: true, last_id: "claude new" },
    { data: [{ id: "claude-old" }], has_more: false },
  );

  const models = await client.list("anthropic", "key", SIGNAL);

  expect(models.map(({ id }) => id)).toEqual(["claude-new", "claude-old"]);
  expect(urls.map((url) => new URL(url).search)).toEqual([
    "?limit=1000",
    "?limit=1000&after_id=claude%20new",
  ]);
});

it("refuses a cursor that repeats", async () => {
  const { client } = pages({
    data: [{ id: "claude-a" }],
    has_more: true,
    last_id: "claude-a",
  });

  await expect(client.list("anthropic", "key", SIGNAL)).rejects.toMatchObject({
    code: "provider_bad_response",
  });
});

it("refuses a catalog with more than 10,000 models", async () => {
  const page = (start: number): unknown => ({
    data: Array.from({ length: 6_000 }, (_, index) => ({
      id: `claude-${start + index}`,
    })),
    has_more: true,
    last_id: `cursor-${start}`,
  });
  const { client } = pages(page(0), page(6_000));

  await expect(client.list("anthropic", "key", SIGNAL)).rejects.toMatchObject({
    code: "catalog_limit_exceeded",
  });
});

it("refuses a catalog of more than 32 pages", async () => {
  let page = 0;
  const request = vi.fn<typeof fetch>(async () => {
    page += 1;
    return Response.json({
      data: [{ id: `claude-${page}` }],
      has_more: true,
      last_id: `cursor-${page}`,
    });
  });
  const client = new CatalogProviderClient(new CatalogHttpClient(request));

  await expect(client.list("anthropic", "key", SIGNAL)).rejects.toMatchObject({
    code: "catalog_limit_exceeded",
  });
  expect(request).toHaveBeenCalledTimes(32);
});

it("uses a default transport over the global fetch", async () => {
  const request = vi.fn<typeof fetch>(async () =>
    Response.json({ data: [{ id: "glm-b" }, { id: "glm-a" }] }),
  );
  vi.stubGlobal("fetch", request);

  const models = await new CatalogProviderClient().list("zai", "key", SIGNAL);

  expect(models.map(({ id }) => id)).toEqual(["glm-a", "glm-b"]);
});
