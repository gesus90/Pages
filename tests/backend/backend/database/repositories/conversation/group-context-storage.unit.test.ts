import { describe, expect, it, vi } from "vitest";

import { ConversationGroupContextRepository } from "@/backend/database/repositories/conversation/ConversationGroupContextRepository";

function fixture(): {
  repository: ConversationGroupContextRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn();
  const execute = vi.fn().mockResolvedValue(undefined);
  return {
    repository: new ConversationGroupContextRepository({ query, execute }),
    query,
    execute,
  };
}

describe("group context storage", () => {
  it("reads stored lists and filters malformed source entries", async () => {
    const { repository, query } = fixture();
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        [
          "c",
          "summary",
          '["yes",1]',
          "{}",
          '["owner"]',
          '[{"fromSequence":1,"toSequence":2,"messageIds":["m"]},null,{"fromSequence":"bad"}]',
          2,
          1,
          "unknown",
          null,
          4,
          null,
          null,
        ],
      ]);
    await expect(repository.find("c")).resolves.toBeNull();
    await expect(repository.find("c")).resolves.toMatchObject({
      decisions: ["yes"],
      openItems: [],
      responsibilities: ["owner"],
      status: "unavailable",
      sources: [{ fromSequence: 1, toSequence: 2, messageIds: ["m"] }],
    });
  });

  it("reports concurrent saves and serializes the summary", async () => {
    const { repository, query } = fixture();
    const summary = {
      summary: "text",
      decisions: ["decision"],
      openItems: [],
      responsibilities: [],
      sources: [],
      throughSequence: 2,
      hasExcerpts: false,
      status: "current" as const,
      updatedAt: "now",
    };
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([["c"]]);
    await expect(repository.saveSummary("c", summary, 3)).resolves.toBe(false);
    await expect(repository.saveSummary("c", summary, 3)).resolves.toBe(true);
    expect(query).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({
        expected_revision: 3,
        decisions: '["decision"]',
      }),
    );
  });

  it("exposes source and pending state and records failures", async () => {
    const { repository, query, execute } = fixture();
    query
      .mockResolvedValueOnce([["c", 4]])
      .mockResolvedValueOnce([["c"]])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([["c"]])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([[3]]);
    await expect(repository.candidates(5)).resolves.toEqual([
      { conversationId: "c", throughSequence: 4 },
    ]);
    await expect(repository.changedSources()).resolves.toEqual(["c"]);
    await expect(repository.isSourceCurrent("c")).resolves.toBe(true);
    await expect(repository.isSourceCurrent("c")).resolves.toBe(false);
    await expect(repository.pendingCount("c", 2)).resolves.toBe(0);
    await expect(repository.pendingCount("c", 2)).resolves.toBe(3);
    await repository.recordFailure("c", {
      status: "behind",
      errorCode: "failed",
      attemptedAt: "now",
    });
    await repository.invalidate("c", "now");
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
