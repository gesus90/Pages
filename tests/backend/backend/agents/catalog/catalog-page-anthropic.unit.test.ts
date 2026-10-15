import { describe, expect, it } from "vitest";

import { parseCatalogPage } from "@/backend/agents/catalog/CatalogParsing";
import { AgentError } from "@/backend/error/AgentErrors";

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

function model(capabilities?: unknown): Record<string, unknown> {
  return {
    id: "claude-synthetic",
    display_name: "Claude Synthetic",
    type: "model",
    ...(capabilities === undefined ? {} : { capabilities }),
  };
}

function page(
  models: readonly unknown[],
  extra: Record<string, unknown> = {},
): unknown {
  return {
    data: models,
    has_more: false,
    last_id: "claude-synthetic",
    ...extra,
  };
}

describe("parseCatalogPage for Anthropic", () => {
  it("keeps every entry and never reads prices", () => {
    const result = parseCatalogPage(
      page([{ ...model(), pricing: { prompt: "1", completion: "1" } }]),
      "anthropic",
    );
    expect(result.models).toEqual([
      {
        id: "claude-synthetic",
        name: "Claude Synthetic",
        contextWindow: null,
        promptPrice: null,
        completionPrice: null,
        isFree: false,
        reasoning: "unknown",
        reasoningEfforts: [],
        defaultReasoningEffort: null,
      },
    ]);
    expect(result.nextCursor).toBeNull();
  });

  it("orders supported efforts along the documented ladder", () => {
    const capabilities = {
      effort: {
        supported: true,
        max: { supported: true },
        xhigh: { supported: true },
        low: { supported: true },
        medium: { supported: false },
        high: { supported: true },
      },
    };
    const [entry] = parseCatalogPage(
      page([model(capabilities)]),
      "anthropic",
    ).models;
    expect(entry).toMatchObject({
      reasoning: "levels",
      reasoningEfforts: ["low", "high", "xhigh", "max"],
      defaultReasoningEffort: null,
    });
  });

  it("appends an effort outside the ladder after the known ones", () => {
    const capabilities = {
      effort: {
        supported: true,
        ultra: { supported: true },
        low: { supported: true },
      },
    };
    const [entry] = parseCatalogPage(
      page([model(capabilities)]),
      "anthropic",
    ).models;
    expect(entry.reasoningEfforts).toEqual(["low", "ultra"]);
  });

  it.each([
    ["missing capabilities", undefined, "unknown"],
    ["null capabilities", null, "unknown"],
    ["unsupported effort", { effort: { supported: false } }, "none"],
    [
      "supported effort without levels",
      { effort: { supported: true } },
      "none",
    ],
    [
      "only unsupported levels",
      { effort: { supported: true, low: { supported: false } } },
      "none",
    ],
  ])("reports %s as %s", (_, capabilities, reasoning) => {
    const [entry] = parseCatalogPage(
      page([model(capabilities)]),
      "anthropic",
    ).models;
    expect(entry.reasoning).toBe(reasoning);
    expect(entry.reasoningEfforts).toEqual([]);
  });

  it("prefers an explicit effort list in the entry over capabilities", () => {
    const entry = {
      ...model({ effort: { supported: false } }),
      reasoning: { supported_efforts: ["low"], default_effort: "low" },
    };
    const [parsed] = parseCatalogPage(page([entry]), "anthropic").models;
    expect(parsed).toMatchObject({
      reasoning: "levels",
      reasoningEfforts: ["low"],
      defaultReasoningEffort: "low",
    });
  });
});

describe("parseCatalogPage pagination for Anthropic", () => {
  it("returns the last ID as the cursor while more models follow", () => {
    const result = parseCatalogPage(
      page([model()], { has_more: true, last_id: "claude-cursor" }),
      "anthropic",
    );
    expect(result.nextCursor).toBe("claude-cursor");
  });

  it("ends the listing when has_more is false, even with a last ID", () => {
    expect(
      parseCatalogPage(page([model()], { has_more: false }), "anthropic")
        .nextCursor,
    ).toBeNull();
  });

  it.each([
    ["has_more missing", page([model()], { has_more: undefined })],
    ["has_more not a boolean", page([model()], { has_more: "true" })],
    [
      "a missing cursor",
      page([model()], { has_more: true, last_id: undefined }),
    ],
    ["an empty cursor", page([model()], { has_more: true, last_id: "" })],
    [
      "a cursor with control characters",
      page([model()], { has_more: true, last_id: "a\nb" }),
    ],
    [
      "an overlong cursor",
      page([model()], { has_more: true, last_id: "x".repeat(201) }),
    ],
    ["an entry that is no object", page([null])],
    ["an entry without an ID", page([{ display_name: "Nameless" }])],
  ])("rejects a page with %s", (_, payload) => {
    expectBadResponse(() => parseCatalogPage(payload, "anthropic"));
  });
});
