import { describe, expect, it, vi } from "vitest";

import { CatalogHttpClient } from "@/backend/agents/catalog/CatalogHttpClient";
import {
  isCatalogModelId,
  parseCatalogPage,
  parseStoredCatalog,
} from "@/backend/agents/catalog/CatalogParsing";
import { CatalogProviderClient } from "@/backend/agents/catalog/CatalogProviderClient";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  emptyModelCatalog,
  isCatalogInterval,
  isReasoningEffortToken,
  supportsModelCatalog,
} from "@/definition/AgentModelCatalog";

import type { ApiProviderId } from "@/definition/AgentConnection";

const SIGNAL = new AbortController().signal;
// Metadata with which each catalog marks an entry as a text model.
const TEXT = {
  architecture: { input_modalities: ["text"], output_modalities: ["text"] },
};
const GENERATES = { supportedGenerationMethods: ["generateContent"] };

function catalog(provider: ApiProviderId, request: typeof fetch) {
  const client = new CatalogProviderClient(new CatalogHttpClient(request));
  return client.list(provider, "synthetic-secret-marker", SIGNAL);
}

function payloadResponse(payload: unknown) {
  return Response.json(payload);
}

describe("token-free provider catalog adapters", () => {
  it("issues only native authenticated GET listings for the four supported providers", async () => {
    const cases: readonly [ApiProviderId, unknown, string, string][] = [
      [
        "openai",
        { data: [{ id: "model", owned_by: "private", created: 1 }] },
        "https://api.openai.com/v1/models",
        "Authorization",
      ],
      [
        "openrouter",
        {
          data: [
            {
              id: "vendor/model",
              name: "Friendly",
              context_length: 123,
              pricing: { prompt: "0", completion: "0.000" },
              ...TEXT,
            },
          ],
        },
        "https://openrouter.ai/api/v1/models?output_modalities=text&limit=1000&offset=0",
        "Authorization",
      ],
      [
        "google_ai_studio",
        {
          models: [
            {
              name: "models/model",
              displayName: "Friendly",
              inputTokenLimit: 1024,
              ...GENERATES,
            },
          ],
        },
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
        "x-goog-api-key",
      ],
      [
        "anthropic",
        { data: [{ id: "model", display_name: "Friendly" }], has_more: false },
        "https://api.anthropic.com/v1/models?limit=1000",
        "x-api-key",
      ],
    ];
    for (const [provider, payload, url, header] of cases) {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(payloadResponse(payload));
      const models = await catalog(provider, request);
      expect(models).toHaveLength(1);
      expect(request).toHaveBeenCalledExactlyOnceWith(
        url,
        expect.objectContaining({
          method: "GET",
          redirect: "error",
          signal: SIGNAL,
        }),
      );
      expect(request.mock.calls[0]?.[1]?.headers).toHaveProperty(header);
      expect(request.mock.calls[0]?.[1]?.body).toBeUndefined();
      expect(JSON.stringify(models)).not.toContain("private");
    }
    const request = vi.fn<typeof fetch>();
    await expect(catalog("zai", request)).rejects.toMatchObject({
      code: "catalog_unsupported",
    });
    expect(request).not.toHaveBeenCalled();
    expect(supportsModelCatalog("zai")).toBe(false);
    // CLI connections list the models of their signed-in CLI instead.
    expect(supportsModelCatalog("codex_cli")).toBe(true);
    expect(supportsModelCatalog("claude_code")).toBe(true);
    expect(isCatalogInterval(24)).toBe(true);
    expect(isCatalogInterval(NaN)).toBe(false);
    expect(emptyModelCatalog().intervalHours).toBe(0);
  });

  it("follows Google and Anthropic cursors, encodes them, deduplicates and keeps the complete catalog", async () => {
    const google = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        payloadResponse({
          models: [{ name: "models/z", ...GENERATES }],
          nextPageToken: "a&b?",
        }),
      )
      .mockResolvedValueOnce(
        payloadResponse({
          models: [
            { name: "models/a", ...GENERATES },
            { name: "models/z", displayName: "Updated", ...GENERATES },
          ],
          nextPageToken: "",
        }),
      );
    expect(
      (await catalog("google_ai_studio", google)).map((model) => [
        model.id,
        model.name,
      ]),
    ).toEqual([
      ["models/a", "models/a"],
      ["models/z", "Updated"],
    ]);
    expect(google.mock.calls[1]?.[0]).toContain("pageToken=a%26b%3F");
    const anthropic = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        payloadResponse({
          data: [{ id: "z" }],
          has_more: true,
          last_id: "z/?",
        }),
      )
      .mockResolvedValueOnce(
        payloadResponse({ data: [{ id: "a" }], has_more: false }),
      );
    // Anthropic lists newer models first, so its order is kept.
    expect(
      (await catalog("anthropic", anthropic)).map((model) => model.id),
    ).toEqual(["z", "a"]);
    expect(anthropic.mock.calls[1]?.[0]).toContain("after_id=z%2F%3F");
  });

  it("follows OpenRouter offset pages of text models without trusting next-page URLs", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: "model/a", ...TEXT }],
          total_count: 2,
          links: { next: "https://untrusted.invalid" },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "model/b", ...TEXT }], total_count: 2 }),
      );
    expect(
      (await catalog("openrouter", request)).map((model) => model.id),
    ).toEqual(["model/a", "model/b"]);
    expect(request.mock.calls[1]?.[0]).toBe(
      "https://openrouter.ai/api/v1/models?output_modalities=text&limit=1000&offset=1",
    );
    expect(
      parseCatalogPage(
        { data: Array.from({ length: 1000 }, () => ({ id: "model" })) },
        "openrouter",
      ).nextCursor,
    ).toBe("1000");
    // The live listing mixes alias IDs with a leading "~" into the only page.
    expect(
      parseCatalogPage(
        {
          data: [
            { id: "~vendor/model-latest", ...TEXT },
            {
              id: "openrouter/free",
              pricing: { prompt: "0", completion: "0" },
              ...TEXT,
            },
          ],
          total_count: 2,
          links: { next: null },
        },
        "openrouter",
      ),
    ).toMatchObject({
      models: [
        { id: "~vendor/model-latest", isFree: false },
        { id: "openrouter/free", isFree: true },
      ],
      nextCursor: null,
    });
    for (const payload of [
      { data: [], total_count: 1 },
      { data: [{ id: "x" }], has_more: true },
      { data: [{ id: "x" }], total_count: 0 },
      { data: [], total_count: "2" },
    ])
      expect(() => parseCatalogPage(payload, "openrouter")).toThrow(AgentError);
  });

  it("labels Free only when both authoritative prices are zero, without numeric underflow or name inference", () => {
    const prices: readonly [unknown, unknown, boolean][] = [
      ["0", "0", true],
      [0, 0, true],
      ["0.000e-10", "00.0", true],
      ["0", "0.01", false],
      ["0.1", "0", false],
      [undefined, "0", false],
      ["", "0", false],
      ["-0", "0", false],
      ["free", "0", false],
      ["1e-999", "0", false],
      [null, "0", false],
      [Infinity, 0, false],
      ["0".repeat(65), "0", false],
      [false, "0", false],
    ];
    for (const [prompt, completion, isFree] of prices) {
      const model = parseCatalogPage(
        {
          data: [
            { id: "model:free", pricing: { prompt, completion }, ...TEXT },
          ],
        },
        "openrouter",
      ).models[0];
      expect(model.isFree).toBe(isFree);
    }
    expect(
      parseCatalogPage(
        { data: [{ id: "free", pricing: { prompt: "0", completion: "0" } }] },
        "openai",
      ).models[0].isFree,
    ).toBe(false);
  });

  it("rejects malformed pages, identifiers, cursors and unexpected partial listings", () => {
    const cases: readonly [ApiProviderId, unknown][] = [
      ["openai", {}],
      ["openai", { data: {} }],
      ["openai", { data: [null] }],
      ["openai", { data: [{ id: "" }] }],
      ["openai", { data: [{ id: "x".repeat(201) }] }],
      ["openai", { data: [{ id: "bad\nmodel" }] }],
      ["openai", { data: [{ id: "bad model" }] }],
      ["openrouter", { data: [{ id: "~~vendor/model", ...TEXT }] }],
      ["openrouter", { data: [{ id: "~", ...TEXT }] }],
      ["openai", { data: [{ id: "model[1M]" }] }],
      ["openai", { data: [{ id: "model[1m][1m]" }] }],
      ["openai", { data: [{ id: "model[1m" }] }],
      ["openai", { data: [{ id: "mod[1m]el" }] }],
      ["openai", { data: [{ id: "model[]" }] }],
      ["openai", { data: [{ id: "[1m]" }] }],
      ["openai", { data: [], has_more: true }],
      ["anthropic", { data: [] }],
      ["anthropic", { data: [], has_more: true }],
      ["anthropic", { data: [], has_more: true, last_id: 123 }],
      ["google_ai_studio", { models: [], nextPageToken: null }],
      ["google_ai_studio", { models: [], nextPageToken: "x".repeat(2049) }],
      ["openai", { data: Array.from({ length: 10001 }, () => ({ id: "x" })) }],
    ];
    for (const [provider, payload] of cases)
      expect(() => parseCatalogPage(payload, provider)).toThrow(AgentError);
    for (const context_length of [-1, Infinity, 1.5, "123", null])
      expect(
        parseCatalogPage(
          { data: [{ id: "x", context_length, name: "bad\nname", ...TEXT }] },
          "openrouter",
        ).models[0],
      ).toMatchObject({ contextWindow: null, name: "x" });
  });

  it("rejects pagination cycles and page/model limits without returning a partial result", async () => {
    const cycle = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        payloadResponse({ models: [], nextPageToken: "again" }),
      );
    await expect(catalog("google_ai_studio", cycle)).rejects.toMatchObject({
      code: "provider_bad_response",
    });
    expect(cycle).toHaveBeenCalledTimes(2);
    let page = 0;
    const pages = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        payloadResponse({ models: [], nextPageToken: String(++page) }),
      );
    await expect(catalog("google_ai_studio", pages)).rejects.toMatchObject({
      code: "catalog_limit_exceeded",
    });
    expect(pages).toHaveBeenCalledTimes(32);
    const models = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        payloadResponse({
          models: Array.from({ length: 10000 }, (_, index) => ({
            name: `models/m${index}`,
            ...GENERATES,
          })),
          nextPageToken: "next",
        }),
      )
      .mockResolvedValueOnce(
        payloadResponse({ models: [{ name: "models/extra", ...GENERATES }] }),
      );
    await expect(catalog("google_ai_studio", models)).rejects.toMatchObject({
      code: "catalog_limit_exceeded",
    });
  });

  it("bounds streamed page bytes and the total response budget", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("x".repeat(8 * 1024 * 1024 + 1)));
    await expect(catalog("openai", request)).rejects.toMatchObject({
      code: "catalog_limit_exceeded",
    });
    const bounded = new CatalogHttpClient(
      vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: [] })),
    );
    await expect(
      bounded.get({
        provider: "openai",
        apiKey: "synthetic",
        path: "/models",
        signal: SIGNAL,
        remainingBytes: 1,
      }),
    ).rejects.toMatchObject({ code: "catalog_limit_exceeded" });
    const page =
      JSON.stringify({ models: [], nextPageToken: "next" }) +
      " ".repeat(6 * 1024 * 1024);
    let index = 0;
    const total = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response(page.replace('"next"', `"next${++index}"`)),
      );
    await expect(catalog("google_ai_studio", total)).rejects.toMatchObject({
      code: "catalog_limit_exceeded",
    });
    expect(total).toHaveBeenCalledTimes(3);
  });

  it("sanitizes HTTP, structured, JSON, empty-body, network and deadline failures", async () => {
    const cases: readonly [Response, string][] = [
      [new Response("secret-marker", { status: 401 }), "provider_auth_failed"],
      [
        Response.json({ error: { message: "secret-marker", code: 429 } }),
        "provider_rate_limited",
      ],
      [new Response("invalid-json"), "provider_bad_response"],
      [new Response(null), "provider_bad_response"],
      [new Response(null, { status: 403 }), "provider_permission_denied"],
    ];
    for (const [response, code] of cases)
      await expect(
        catalog(
          "openai",
          vi.fn<typeof fetch>().mockResolvedValueOnce(response),
        ),
      ).rejects.toMatchObject({ code });
    // An invalid Gemini key is a 400 whose body names API_KEY_INVALID, as in the access check.
    const geminiErrors: readonly [unknown, string][] = [
      [
        {
          error: {
            code: 400,
            message: "synthetic-secret-marker",
            status: "INVALID_ARGUMENT",
            details: [{ reason: "API_KEY_INVALID" }],
          },
        },
        "provider_auth_failed",
      ],
      [
        { error: { code: 400, status: "INVALID_ARGUMENT" } },
        "provider_request_rejected",
      ],
    ];
    for (const [payload, code] of geminiErrors)
      await expect(
        catalog(
          "google_ai_studio",
          vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json(payload, { status: 400 })),
        ),
      ).rejects.toMatchObject({ code });
    // An unsuccessful answer without any recognizable status or code still fails safely.
    const inconsistent = Response.json({});
    Object.defineProperty(inconsistent, "ok", { value: false });
    await expect(
      catalog(
        "openai",
        vi.fn<typeof fetch>().mockResolvedValueOnce(inconsistent),
      ),
    ).rejects.toMatchObject({ code: "provider_bad_response" });
    await expect(
      catalog(
        "openai",
        vi
          .fn<typeof fetch>()
          .mockRejectedValueOnce(new Error("synthetic-secret-marker")),
      ),
    ).rejects.toMatchObject({ code: "provider_unreachable" });
    const controller = new AbortController();
    controller.abort();
    const request = vi.fn<typeof fetch>();
    await expect(
      new CatalogProviderClient(new CatalogHttpClient(request)).list(
        "openai",
        "synthetic",
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "check_timeout" });
    expect(request).not.toHaveBeenCalled();
    const aborted = new AbortController();
    const aborting = vi.fn<typeof fetch>().mockImplementation(async () => {
      aborted.abort();
      return Response.json({ data: [] });
    });
    await expect(
      new CatalogProviderClient(new CatalogHttpClient(aborting)).list(
        "openai",
        "synthetic",
        aborted.signal,
      ),
    ).rejects.toMatchObject({ code: "check_timeout" });
    // The default fetch wiring is exercised with a synthetic global transport.
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: [] })),
    );
    expect(
      await new CatalogProviderClient().list("openai", "synthetic", SIGNAL),
    ).toEqual([]);
  });
});

function reasoningOf(provider: ApiProviderId, entry: Record<string, unknown>) {
  const payload =
    provider === "google_ai_studio"
      ? { models: [{ name: "models/test", ...GENERATES, ...entry }] }
      : { data: [{ id: "test", ...TEXT, ...entry }], has_more: false };
  const [model] = parseCatalogPage(payload, provider).models;
  return [
    model?.reasoning,
    model?.reasoningEfforts,
    model?.defaultReasoningEffort,
  ];
}

describe("reasoning support from provider catalogs", () => {
  it("takes OpenRouter's listed efforts and default, deduplicated and bounded", () => {
    expect(reasoningOf("openrouter", {})).toEqual(["none", [], null]);
    expect(
      reasoningOf("openrouter", {
        reasoning: {
          supported_efforts: ["low", "high", "low"],
          default_effort: "high",
        },
      }),
    ).toEqual(["levels", ["low", "high"], "high"]);
    expect(
      reasoningOf("openrouter", {
        reasoning: { supported_efforts: ["low"], default_effort: "max" },
      }),
    ).toEqual(["levels", ["low"], null]);
    for (const supported of [
      undefined,
      [],
      ["Low effort"],
      Array.from({ length: 9 }, (_, index) => `level${index}`),
    ])
      expect(
        reasoningOf("openrouter", {
          reasoning: { supported_efforts: supported },
        }),
      ).toEqual(["automatic", [], null]);
  });

  it("reads Anthropic effort capabilities and leaves missing ones unknown", () => {
    expect(reasoningOf("anthropic", {})).toEqual(["unknown", [], null]);
    expect(reasoningOf("anthropic", { capabilities: null })).toEqual([
      "unknown",
      [],
      null,
    ]);
    expect(
      reasoningOf("anthropic", {
        capabilities: { effort: { supported: false } },
      }),
    ).toEqual(["none", [], null]);
    expect(
      reasoningOf("anthropic", {
        capabilities: {
          effort: {
            supported: true,
            low: { supported: true },
            medium: { supported: false },
            max: { supported: true },
            extreme: { supported: true },
          },
        },
      }),
    ).toEqual(["levels", ["low", "max", "extreme"], null]);
    expect(
      reasoningOf("anthropic", {
        capabilities: { effort: { supported: true } },
      }),
    ).toEqual(["none", [], null]);
  });

  it("maps Google's thinking flag and OpenAI's silence without inventing levels", () => {
    expect(reasoningOf("google_ai_studio", { thinking: true })).toEqual([
      "automatic",
      [],
      null,
    ]);
    expect(reasoningOf("google_ai_studio", { thinking: false })).toEqual([
      "none",
      [],
      null,
    ]);
    expect(reasoningOf("google_ai_studio", {})).toEqual(["unknown", [], null]);
    expect(reasoningOf("openai", {})).toEqual(["unknown", [], null]);
    expect(isReasoningEffortToken("xhigh")).toBe(true);
    expect(isReasoningEffortToken("x high")).toBe(false);
    expect(isReasoningEffortToken(3)).toBe(false);
  });

  it("restores stored reasoning support and reads older snapshots as unknown", () => {
    const stored = parseStoredCatalog([
      {
        id: "levels",
        reasoning_support: "levels",
        reasoning: {
          supported_efforts: ["low", "high"],
          default_effort: "low",
        },
      },
      { id: "broken", reasoning_support: "levels", reasoning: {} },
      { id: "auto", reasoning_support: "automatic" },
      { id: "legacy" },
      { id: "foreign", reasoning_support: "sometimes" },
    ]);
    expect(
      stored.map((model) => [
        model.id,
        model.reasoning,
        model.reasoningEfforts,
        model.defaultReasoningEffort,
      ]),
    ).toEqual([
      ["levels", "levels", ["low", "high"], "low"],
      ["broken", "unknown", [], null],
      ["auto", "automatic", [], null],
      ["legacy", "unknown", [], null],
      ["foreign", "unknown", [], null],
    ]);
    expect(() => parseStoredCatalog({ data: [] })).toThrow(
      expect.objectContaining({ code: "provider_bad_response" }),
    );
  });
});

describe("explicit catalog reasoning metadata", () => {
  it.each(["google_ai_studio", "openai", "openrouter", "anthropic"] as const)(
    "keeps exactly the listed %s levels, without defaults or name inference",
    (provider) => {
      expect(
        reasoningOf(provider, {
          thinking: true,
          reasoning: {
            supported_efforts: ["minimal", "high", "minimal"],
            default_effort: "low",
          },
        }),
      ).toEqual(["levels", ["minimal", "high"], null]);
      expect(
        reasoningOf(provider, {
          reasoning: {
            supported_efforts: ["custom"],
            default_effort: "custom",
          },
        }),
      ).toEqual(["levels", ["custom"], "custom"]);
    },
  );
  it("keeps native Google thinking responses without levels explicit and ignores malformed stage metadata", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        models: [
          { name: "models/reasoner", thinking: true, ...GENERATES },
          {
            name: "models/listed",
            thinking: true,
            reasoning: { supported_efforts: ["low", "high"] },
            ...GENERATES,
          },
          {
            name: "models/invalid",
            thinking: true,
            reasoning: { supported_efforts: ["invented stage"] },
            ...GENERATES,
          },
        ],
      }),
    );
    const models = await catalog("google_ai_studio", request);
    expect(models.map((model) => [model.id, model.reasoningEfforts])).toEqual([
      ["models/invalid", []],
      ["models/listed", ["low", "high"]],
      ["models/reasoner", []],
    ]);
    expect(request).toHaveBeenCalledOnce();
  });
});

describe("text models only", () => {
  it("keeps OpenRouter models that read text and write only text, by their listed modalities", async () => {
    const entry = (id: string, input: unknown, output: unknown) => ({
      id,
      architecture: { input_modalities: input, output_modalities: output },
    });
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        data: [
          entry("vendor/chat", ["text"], ["text"]),
          entry("vendor/vision", ["text", "image", "file"], ["text"]),
          entry("vendor/image", ["text", "image"], ["image"]),
          entry("vendor/image-chat", ["text", "image"], ["image", "text"]),
          entry("vendor/audio-chat", ["text", "audio"], ["text", "audio"]),
          entry("vendor/video", ["text"], ["video"]),
          entry("vendor/speech", ["text"], ["speech"]),
          entry("vendor/embedding", ["text"], ["embeddings"]),
          entry("vendor/transcription", ["audio"], ["text"]),
          entry("vendor/unlisted", undefined, ["text"]),
          entry("vendor/malformed", "text", "text"),
          { id: "vendor/no-architecture" },
          { id: "bad id with spaces", architecture: { output_modalities: [] } },
        ],
        total_count: 13,
      }),
    );
    expect(
      (await catalog("openrouter", request)).map((model) => model.id),
    ).toEqual(["vendor/chat", "vendor/vision"]);
    // Pagination counts every listed entry, not only the kept text models.
    expect(
      parseCatalogPage(
        {
          data: Array.from({ length: 1000 }, (_, index) =>
            entry(`vendor/m${index}`, ["text"], index === 0 ? ["text"] : []),
          ),
        },
        "openrouter",
      ),
    ).toMatchObject({ models: [{ id: "vendor/m0" }], nextCursor: "1000" });
  });

  it("keeps Google models that generate content and leaves catalogs without modality data unfiltered", async () => {
    const google = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        models: [
          { name: "models/text", ...GENERATES },
          {
            name: "models/both",
            supportedGenerationMethods: ["countTokens", "generateContent"],
          },
          {
            name: "models/embedding",
            supportedGenerationMethods: ["embedContent"],
          },
          { name: "models/imagen", supportedGenerationMethods: ["predict"] },
          { name: "models/unknown" },
          {
            name: "models/malformed",
            supportedGenerationMethods: "generateContent",
          },
        ],
      }),
    );
    expect(
      (await catalog("google_ai_studio", google)).map((model) => model.id),
    ).toEqual(["models/both", "models/text"]);
    for (const provider of ["openai", "anthropic"] as const)
      expect(
        parseCatalogPage(
          { data: [{ id: "listed" }, { id: "plain-2" }], has_more: false },
          provider,
        ).models.map((model) => model.id),
      ).toEqual(["listed", "plain-2"]);
  });
});

describe("documented reasoning levels", () => {
  it("reads OpenRouter's null allowlist, token budgets and mandatory reasoning as documented", () => {
    const gateway = ["max", "xhigh", "high", "medium", "low", "minimal"];
    expect(
      reasoningOf("openrouter", {
        reasoning: { supported_efforts: null, default_effort: "none" },
      }),
    ).toEqual(["levels", [...gateway, "none"], "none"]);
    expect(
      reasoningOf("openrouter", {
        reasoning: {
          mandatory: true,
          supported_efforts: null,
          default_effort: "none",
        },
      }),
    ).toEqual(["levels", gateway, null]);
    expect(
      reasoningOf("openrouter", {
        reasoning: { mandatory: false, supports_max_tokens: true },
      }),
    ).toEqual(["levels", gateway, null]);
    expect(
      reasoningOf("openrouter", {
        reasoning: {
          mandatory: true,
          supports_max_tokens: true,
          supported_efforts: ["medium", "low"],
          default_effort: "medium",
        },
      }),
    ).toEqual(["levels", ["medium", "low"], "medium"]);
    expect(
      reasoningOf("openrouter", {
        reasoning: { mandatory: true, supported_efforts: ["high", "none"] },
      }),
    ).toEqual(["levels", ["high"], null]);
    expect(
      reasoningOf("openrouter", {
        reasoning: { mandatory: true, supported_efforts: ["none"] },
      }),
    ).toEqual(["automatic", [], null]);
    for (const reasoning of [
      { mandatory: false },
      { mandatory: true, default_enabled: true },
      { supports_max_tokens: false },
      null,
    ])
      expect(reasoningOf("openrouter", { reasoning })).toEqual([
        "automatic",
        [],
        null,
      ]);
  });

  it("offers Google's documented levels only for exactly listed thinking models", () => {
    const google = (name: string, thinking: unknown) => {
      const [model] = parseCatalogPage(
        { models: [{ name, thinking, ...GENERATES }] },
        "google_ai_studio",
      ).models;
      return [
        model?.reasoning,
        model?.reasoningEfforts,
        model?.defaultReasoningEffort,
      ];
    };
    expect(google("models/gemini-3.8-flash", true)).toEqual([
      "levels",
      ["low", "medium", "high"],
      "medium",
    ]);
    expect(google("models/gemini-3-flash-preview", true)).toEqual([
      "levels",
      ["minimal", "low", "medium", "high"],
      "high",
    ]);
    expect(google("models/gemini-3-pro-preview", true)).toEqual([
      "levels",
      ["low", "high"],
      "high",
    ]);
    // Budget-based Gemini 2.5, aliases and unknown versions keep no levels.
    for (const name of [
      "models/gemini-2.5-flash",
      "models/gemini-flash-latest",
      "models/gemini-3.8-flash-001",
      "models/constructor",
    ])
      expect(google(name, true)).toEqual(["automatic", [], null]);
    expect(google("models/gemini-3.8-flash", false)).toEqual([
      "none",
      [],
      null,
    ]);
    expect(google("models/gemini-3.8-flash", "yes")).toEqual([
      "unknown",
      [],
      null,
    ]);
  });

  it("orders Anthropic's alphabetically listed effort capabilities by the documented ladder", () => {
    expect(
      reasoningOf("anthropic", {
        capabilities: {
          effort: {
            high: { supported: true },
            low: { supported: true },
            max: { supported: true },
            medium: { supported: true },
            newlevel: { supported: true },
            supported: true,
            xhigh: { supported: true },
          },
        },
      }),
    ).toEqual([
      "levels",
      ["low", "medium", "high", "xhigh", "max", "newlevel"],
      null,
    ]);
  });
});

describe("model identifiers", () => {
  it("accepts OpenRouter aliases and Claude's 1M-context suffix in listings and stored snapshots", () => {
    for (const id of [
      "claude-opus-5-5[1m]",
      "claude-sonnet-4-6[1m]",
      "~anthropic/claude-sonnet-latest",
      "models/gemini-3.8-flash",
      "x".repeat(200),
    ])
      expect(isCatalogModelId(id)).toBe(true);
    for (const id of [
      "",
      "x".repeat(201),
      "claude[1M]",
      "claude[]",
      "claude[1m][2m]",
      "claude[1m",
      "cla[1m]ude",
      "[1m]",
      "claude [1m]",
      7,
    ])
      expect(isCatalogModelId(id)).toBe(false);
    expect(
      parseStoredCatalog([
        {
          id: "claude-opus-5-5[1m]",
          name: "Opus (1M context)",
          reasoning_support: "levels",
          reasoning: {
            supported_efforts: ["low", "max"],
            default_effort: null,
          },
        },
      ]),
    ).toMatchObject([
      {
        id: "claude-opus-5-5[1m]",
        name: "Opus (1M context)",
        reasoningEfforts: ["low", "max"],
      },
    ]);
  });
});
