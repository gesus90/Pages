import { describe, expect, it, vi } from "vitest";

import { AgentLearningSourceRepository } from "@/backend/database/repositories/employee/AgentLearningSourceRepository";

describe("agent learning sources", () => {
  it("combines visible source rows in chronological order", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        ["2026-01-01 00:00:02", "user", "hello", "Person"],
        ["2026-01-01 00:00:03", "assistant", "reply", "Person"],
      ])
      .mockResolvedValueOnce([
        ["2026-01-01T00:00:01Z", "", "Agent", "self", "agent"],
        ["2026-01-01T00:00:04Z", "Group", "Person", "hello", "person"],
      ])
      .mockResolvedValueOnce([
        ["2026-01-01 00:00:05", "Project", null, "updated"],
      ])
      .mockResolvedValueOnce([
        ["2026-01-01 00:00:06", "Team", "PAGE-1", "Title"],
      ])
      .mockResolvedValueOnce([
        ["2026-01-01T00:00:07Z", "Project", "succeeded", '{"summary":"done"}'],
        ["2026-01-01T00:00:08Z", "Project", "failed", "bad json"],
        ["2026-01-01T00:00:09Z", "Project", "done", '{"message":"message"}'],
      ]);
    const sources = await new AgentLearningSourceRepository({ query }).read(
      "agent",
      { since: null, limit: 10 },
    );
    expect(sources.map(({ origin }) => origin)).toEqual([
      "→ Agent",
      "Person",
      "→ Person",
      "Group · Person",
      "Project",
      "Team",
      "Project",
      "Project",
      "Project",
    ]);
    expect(sources.map(({ text }) => text)).toEqual([
      "self",
      "hello",
      "reply",
      "hello",
      "updated",
      "PAGE-1: Title",
      "succeeded: done",
      "failed",
      "done: message",
    ]);
    expect(query).toHaveBeenCalledTimes(5);
  });

  it("falls back to run status for absent or unusable reports", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        ["2026-01-01T00:00:00Z", "P", "a", null],
        ["2026-01-01T00:00:01Z", "P", "b", "null"],
        ["2026-01-01T00:00:02Z", "P", "c", '{"summary":"","message":1}'],
      ]);
    const sources = await new AgentLearningSourceRepository({ query }).read(
      "agent",
      { since: "2025-01-01 00:00:00", limit: 3 },
    );
    expect(sources.map(({ text }) => text)).toEqual(["a", "b", "c"]);
  });
});
