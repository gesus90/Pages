import { describe, expect, it } from "vitest";

import {
  OPENROUTER_BUDGET_EFFORTS,
  OPENROUTER_GATEWAY_EFFORTS,
  documentedGoogleThinkingLevels,
} from "@/backend/agents/catalog/DocumentedReasoningLevels";

describe("documentedGoogleThinkingLevels", () => {
  it("returns the documented levels and default of a named model", () => {
    expect(documentedGoogleThinkingLevels("gemini-3.1-pro-preview")).toEqual({
      efforts: ["low", "medium", "high"],
      defaultEffort: "high",
    });
    expect(documentedGoogleThinkingLevels("gemini-3.5-flash-lite")).toEqual({
      efforts: ["minimal", "low", "medium", "high"],
      defaultEffort: "minimal",
    });
  });

  it("keeps a documented default inside the documented levels", () => {
    for (const id of [
      "gemini-3.8-flash",
      "gemini-3.6-flash",
      "gemini-3-pro-preview",
      "gemini-robotics-er-2-preview",
    ]) {
      const documented = documentedGoogleThinkingLevels(id);
      expect(documented?.efforts).toContain(documented?.defaultEffort);
    }
  });

  it.each([
    "gemini-flash-latest",
    "gemini-2.5-flash",
    "models/gemini-3.5-flash",
    "GEMINI-3.5-FLASH",
    "gemini-3.5-flash-lite-preview",
    "",
  ])("knows nothing about %j", (id) => {
    expect(documentedGoogleThinkingLevels(id)).toBeNull();
  });

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "does not resolve the inherited property %s",
    (id) => {
      expect(documentedGoogleThinkingLevels(id)).toBeNull();
    },
  );
});

describe("OpenRouter effort tables", () => {
  it("lists the gateway efforts from highest to none", () => {
    expect(OPENROUTER_GATEWAY_EFFORTS).toEqual([
      "max",
      "xhigh",
      "high",
      "medium",
      "low",
      "minimal",
      "none",
    ]);
  });

  it("offers no none effort to models that only take a token budget", () => {
    expect(OPENROUTER_BUDGET_EFFORTS).not.toContain("none");
    expect(OPENROUTER_BUDGET_EFFORTS).toEqual(
      OPENROUTER_GATEWAY_EFFORTS.filter((effort) => effort !== "none"),
    );
  });
});
