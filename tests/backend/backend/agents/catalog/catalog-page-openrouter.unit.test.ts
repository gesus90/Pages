import { describe, expect, it } from "vitest";

import { parseCatalogPage } from "@/backend/agents/catalog/CatalogParsing";
import { AgentError } from "@/backend/error/AgentErrors";

const TEXT_ARCHITECTURE = {
  input_modalities: ["text"],
  output_modalities: ["text"],
};

function entry(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "vendor/model",
    name: "Vendor Model",
    context_length: 128_000,
    architecture: TEXT_ARCHITECTURE,
    pricing: { prompt: "0.000001", completion: "0.000002" },
    ...fields,
  };
}

function expectBadResponse(run: () => unknown): void {
  let thrown: unknown;
  try {
    run();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AgentError);
  expect(thrown).toMatchObject({ code: "provider_bad_response" });
}

describe("parseCatalogPage for OpenRouter", () => {
  it("reads name, context window and prices of a text model", () => {
    const page = parseCatalogPage({ data: [entry()] }, "openrouter");
    expect(page).toEqual({
      models: [
        {
          id: "vendor/model",
          name: "Vendor Model",
          contextWindow: 128_000,
          promptPrice: "0.000001",
          completionPrice: "0.000002",
          isFree: false,
          reasoning: "none",
          reasoningEfforts: [],
          defaultReasoningEffort: null,
        },
      ],
      nextCursor: null,
    });
  });

  it.each([
    ["string zeros", { prompt: "0", completion: "0" }, true],
    ["decimal zeros", { prompt: "0.0", completion: "0.00" }, true],
    ["numeric zeros", { prompt: 0, completion: 0 }, true],
    ["one free price", { prompt: "0", completion: "0.000002" }, false],
    ["a router's negative price", { prompt: "-1", completion: "-1" }, false],
    ["no prices", {}, false],
  ])("derives isFree from %s", (_, pricing, isFree) => {
    const [model] = parseCatalogPage(
      { data: [entry({ pricing })] },
      "openrouter",
    ).models;
    expect(model.isFree).toBe(isFree);
  });

  it("drops prices that are not plain decimal numbers", () => {
    const [model] = parseCatalogPage(
      {
        data: [entry({ pricing: { prompt: "1e-7", completion: "cheap" } })],
      },
      "openrouter",
    ).models;
    expect(model.promptPrice).toBe("1e-7");
    expect(model.completionPrice).toBeNull();
  });

  it("filters non-text models but still counts them for pagination", () => {
    const image = entry({
      id: "vendor/image",
      architecture: {
        input_modalities: ["text"],
        output_modalities: ["image"],
      },
    });
    const page = parseCatalogPage(
      { data: [entry(), image], total_count: 5 },
      "openrouter",
    );
    expect(page.models.map((model) => model.id)).toEqual(["vendor/model"]);
    expect(page.nextCursor).toBe("2");
  });

  it("falls back to the ID for a name with control characters", () => {
    const [model] = parseCatalogPage(
      { data: [entry({ name: "Bad\u0000Name" })] },
      "openrouter",
    ).models;
    expect(model.name).toBe("vendor/model");
  });

  it.each([
    ["a fractional value", 1.5],
    ["zero", 0],
    ["a string", "128000"],
  ])("ignores a context window that is %s", (_, contextLength) => {
    const [model] = parseCatalogPage(
      { data: [entry({ context_length: contextLength })] },
      "openrouter",
    ).models;
    expect(model.contextWindow).toBeNull();
  });
});

describe("parseCatalogPage reasoning for OpenRouter", () => {
  function reasoningOf(
    reasoning: unknown,
  ): ReturnType<typeof parseCatalogPage> {
    return parseCatalogPage({ data: [entry({ reasoning })] }, "openrouter");
  }

  it("lists the efforts a model supports with its default", () => {
    const [model] = reasoningOf({
      supported_efforts: ["low", "high"],
      default_effort: "high",
    }).models;
    expect(model).toMatchObject({
      reasoning: "levels",
      reasoningEfforts: ["low", "high"],
      defaultReasoningEffort: "high",
    });
  });

  it("offers every gateway effort when the allowlist is null", () => {
    const [model] = reasoningOf({ supported_efforts: null }).models;
    expect(model.reasoningEfforts).toEqual([
      "max",
      "xhigh",
      "high",
      "medium",
      "low",
      "minimal",
      "none",
    ]);
  });

  it("removes the none effort for a mandatory reasoning model", () => {
    const [model] = reasoningOf({
      supported_efforts: null,
      mandatory: true,
    }).models;
    expect(model.reasoningEfforts).not.toContain("none");
    expect(model.reasoningEfforts).toContain("minimal");
  });

  it("offers the budget efforts to a model that only takes max tokens", () => {
    const [model] = reasoningOf({ supports_max_tokens: true }).models;
    expect(model.reasoningEfforts).toEqual([
      "max",
      "xhigh",
      "high",
      "medium",
      "low",
      "minimal",
    ]);
  });

  it.each([
    ["no effort information", {}],
    ["an empty effort list", { supported_efforts: [] }],
    ["an unusable effort token", { supported_efforts: ["Very High"] }],
    [
      "only the none effort on a mandatory model",
      { supported_efforts: ["none"], mandatory: true },
    ],
  ])("reports automatic reasoning for %s", (_, reasoning) => {
    const [model] = reasoningOf(reasoning).models;
    expect(model).toMatchObject({
      reasoning: "automatic",
      reasoningEfforts: [],
    });
  });

  it("drops a default effort the model does not list", () => {
    const [model] = reasoningOf({
      supported_efforts: ["low", "high"],
      default_effort: "medium",
    }).models;
    expect(model.defaultReasoningEffort).toBeNull();
  });
});

describe("parseCatalogPage pagination for OpenRouter", () => {
  function page(count: number, extra: Record<string, unknown>): unknown {
    const catalogEntries = Array.from({ length: count }, (_, index) =>
      entry({ id: `vendor/model-${index}` }),
    );
    return { data: catalogEntries, ...extra };
  }

  it("continues at the next offset while the total is not reached", () => {
    expect(
      parseCatalogPage(page(100, { total_count: 250 }), "openrouter", 100)
        .nextCursor,
    ).toBe("200");
  });

  it("ends at the last page of a known total", () => {
    expect(
      parseCatalogPage(page(50, { total_count: 250 }), "openrouter", 200)
        .nextCursor,
    ).toBeNull();
  });

  it("continues after a full page of 1000 when no total is stated", () => {
    expect(parseCatalogPage(page(1000, {}), "openrouter").nextCursor).toBe(
      "1000",
    );
    expect(parseCatalogPage(page(999, {}), "openrouter").nextCursor).toBeNull();
  });

  it.each([
    ["has_more is true", { has_more: true }, 3],
    ["the total is below what was read", { total_count: 2 }, 3],
    ["the total is not a number", { total_count: "5" }, 3],
    ["the total is fractional", { total_count: 5.5 }, 3],
    ["an empty page claims more data", { total_count: 10 }, 0],
  ])("rejects a page when %s", (_, extra, count) => {
    expectBadResponse(() => parseCatalogPage(page(count, extra), "openrouter"));
  });
});

describe("parseCatalogPage input validation for OpenRouter", () => {
  it.each([
    ["a payload that is not an object", "models"],
    ["a payload without data", {}],
    ["data that is not a list", { data: {} }],
    ["an ID that cannot be stored", { data: [entry({ id: "bad id" })] }],
    ["an entry without an ID", { data: [entry({ id: undefined })] }],
  ])("rejects %s", (_, payload) => {
    expectBadResponse(() => parseCatalogPage(payload, "openrouter"));
  });

  it("rejects more than 10000 entries and accepts exactly 10000", () => {
    const ten = (count: number): unknown => ({
      data: Array.from({ length: count }, () => null),
    });
    expect(parseCatalogPage(ten(10_000), "openrouter").nextCursor).toBe(
      "10000",
    );
    expectBadResponse(() => parseCatalogPage(ten(10_001), "openrouter"));
  });

  it("silently skips entries that are no objects as non-text models", () => {
    const page = parseCatalogPage({ data: [null, "x", entry()] }, "openrouter");
    expect(page.models).toHaveLength(1);
  });
});
