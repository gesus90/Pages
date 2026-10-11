import { describe, expect, it } from "vitest";

import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import {
  EMPTY_AGENT_FILTERS,
  matchesAgentFilters,
  readAgentFilters,
} from "@/definition/AgentFilters";

import type { AgentFilters } from "@/definition/AgentFilters";
import type { AgentProfile } from "@/definition/AgentProfile";

const profile: AgentProfile = {
  id: "worker",
  name: "Worker",
  connectionId: "access",
  model: "model-a",
  reasoningEffort: null,
  isActive: true,
  purposes: ["agent"],
  targets: [{ kind: "person", targetId: "bob" }],
  configuration: { ...emptyAgentConfiguration(), tag: "coding" },
};

describe("A10 central catalog display filters", () => {
  it("bounds query filters and matches every dimension without granting missing availability", () => {
    expect(readAgentFilters(new URLSearchParams())).toEqual(
      EMPTY_AGENT_FILTERS,
    );
    expect(
      readAgentFilters(
        new URLSearchParams({
          agent_search: "x".repeat(250),
          agent_provider: "openai",
        }),
      ),
    ).toMatchObject({ search: "x".repeat(200), provider: "openai" });
    function matches(filters: Partial<AgentFilters>): boolean {
      return matchesAgentFilters(profile, {
        filters: { ...EMPTY_AGENT_FILTERS, ...filters },
        provider: "openai",
        availability: { isUsable: true, reason: null, personalChoices: [] },
      });
    }
    for (const filters of [
      { search: "CODING" },
      { scope: "person" },
      { connection: "access" },
      { provider: "openai" },
      { purpose: "agent" },
      { status: "active" },
      { usability: "usable" },
    ])
      expect(matches(filters)).toBe(true);
    for (const filters of [
      { search: "missing" },
      { scope: "group" },
      { connection: "other" },
      { provider: "google" },
      { purpose: "chat" },
      { status: "inactive" },
      { usability: "blocked" },
    ])
      expect(matches(filters)).toBe(false);
    const context = {
      filters: {
        ...EMPTY_AGENT_FILTERS,
        usability: "blocked",
        scope: "system",
        status: "inactive",
      },
      provider: undefined,
      availability: undefined,
    };
    expect(
      matchesAgentFilters(
        { ...profile, configuration: undefined, targets: [], isActive: false },
        context,
      ),
    ).toBe(true);
    expect(
      matchesAgentFilters(
        { ...profile, configuration: undefined },
        { ...context, filters: { ...EMPTY_AGENT_FILTERS, scope: "person" } },
      ),
    ).toBe(true);
  });
});
