import { describe, expect, it } from "vitest";

import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import {
  EMPTY_AGENT_FILTERS,
  matchesAgentFilters,
  readAgentFilters,
} from "@/definition/AgentFilters";

import type { AgentFilters } from "@/definition/AgentFilters";
import type { AgentAvailability } from "@/definition/AgentAvailability";
import type { AgentProfile } from "@/definition/AgentProfile";

function profile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "profile-1",
    name: "Release Helper",
    connectionId: "connection-1",
    model: "Claude-Sonnet",
    reasoningEffort: null,
    purposes: ["chat"],
    isActive: true,
    targets: [{ kind: "group", targetId: "g1" }],
    ...overrides,
  };
}

const USABLE: AgentAvailability = {
  isUsable: true,
  reason: null,
  personalChoices: [],
};
const BLOCKED: AgentAvailability = {
  isUsable: false,
  reason: null,
  personalChoices: [],
};

function matches(
  filters: Partial<AgentFilters>,
  candidate: AgentProfile = profile(),
  availability: AgentAvailability | null = USABLE,
): boolean {
  return matchesAgentFilters(candidate, {
    filters: { ...EMPTY_AGENT_FILTERS, ...filters },
    provider: "openrouter",
    availability: availability ?? undefined,
  });
}

describe("reading agent filters from the address", () => {
  it("reads every prefixed parameter and cuts each at 200 characters", () => {
    const filters = readAgentFilters(
      new URLSearchParams({
        agent_search: "x".repeat(300),
        agent_scope: "group",
        agent_provider: "openrouter",
        agent_connection: "c1",
        agent_purpose: "chat",
        agent_status: "active",
        agent_usability: "usable",
        unrelated: "ignored",
      }),
    );

    expect(filters).toEqual({
      search: "x".repeat(200),
      scope: "group",
      provider: "openrouter",
      connection: "c1",
      purpose: "chat",
      status: "active",
      usability: "usable",
    });
  });

  it("reads missing parameters as empty", () => {
    expect(readAgentFilters(new URLSearchParams(""))).toEqual(
      EMPTY_AGENT_FILTERS,
    );
  });
});

describe("matching an agent profile", () => {
  it("matches everything for empty filters", () => {
    expect(matches({})).toBe(true);
  });

  it("searches name, tag and model without regard to case", () => {
    const tagged = profile({
      configuration: { ...emptyAgentConfiguration("person"), tag: "nightly" },
    });

    expect(matches({ search: "release" })).toBe(true);
    expect(matches({ search: "SONNET" })).toBe(true);
    expect(matches({ search: "nightly" }, tagged)).toBe(true);
    expect(matches({ search: "nightly" })).toBe(false);
    expect(matches({ search: "unknown" })).toBe(false);
  });

  it("derives the scope from the configuration, else the first target, else system", () => {
    const configured = profile({
      configuration: emptyAgentConfiguration("person"),
    });

    expect(matches({ scope: "person" }, configured)).toBe(true);
    expect(matches({ scope: "group" }, configured)).toBe(false);
    expect(matches({ scope: "group" })).toBe(true);
    expect(matches({ scope: "system" }, profile({ targets: [] }))).toBe(true);
  });

  it("matches the connection, the provider and the purpose exactly", () => {
    expect(matches({ connection: "connection-1" })).toBe(true);
    expect(matches({ connection: "other" })).toBe(false);
    expect(matches({ provider: "openrouter" })).toBe(true);
    expect(matches({ provider: "codex_cli" })).toBe(false);
    expect(matches({ purpose: "chat" })).toBe(true);
    expect(matches({ purpose: "agent" })).toBe(false);
  });

  it("matches the active state and the usability", () => {
    expect(matches({ status: "active" })).toBe(true);
    expect(matches({ status: "inactive" })).toBe(false);
    expect(matches({ status: "inactive" }, profile({ isActive: false }))).toBe(
      true,
    );
    expect(matches({ usability: "usable" })).toBe(true);
    expect(matches({ usability: "blocked" })).toBe(false);
    expect(matches({ usability: "blocked" }, profile(), BLOCKED)).toBe(true);
    expect(matches({ usability: "blocked" }, profile(), null)).toBe(true);
  });

  it("needs every filter to match", () => {
    expect(
      matches({ search: "release", status: "active", usability: "blocked" }),
    ).toBe(false);
  });
});
