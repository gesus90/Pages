import { describe, expect, it, vi } from "vitest";

import { AgentSessionEventRepository } from "@/backend/database/repositories/agent/AgentSessionEventRepository";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { AgentSessionDatabase } from "@/backend/database/repositories/agent/AgentSessionDatabase";
import type { DatabaseTransaction } from "@/backend/database/Database";
import type { NewAgentSessionEvent } from "@/backend/service/agents/sessions/AgentSessionStore";

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  prepare: vi.fn(),
  append: vi.fn(),
  read: vi.fn(),
  row: vi.fn(),
}));
vi.mock("@/backend/storage/AgentPayloadFileStore", () => ({
  requireAgentFiles: () => ({ write: mocks.write }),
}));
vi.mock(
  "@/backend/database/repositories/agent/AgentSessionHistoryChunks",
  () => ({
    prepareSessionHistoryChunks: mocks.prepare,
    appendSessionHistoryChunks: mocks.append,
    readSessionHistoryChunks: mocks.read,
  }),
);
vi.mock("@/backend/database/repositories/agent/AgentSessionRows", () => ({
  readStoredEventRow: mocks.row,
}));

const event: NewAgentSessionEvent = {
  turn: 1,
  kind: "agent_message",
  text: "hello\u0000world",
  isTruncated: false,
  createdAt: "now",
  dedupeKey: "key\u0000x",
};

function fixture(): {
  repository: AgentSessionEventRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn();
  const execute = vi.fn().mockResolvedValue(undefined);
  const transaction = partial<DatabaseTransaction>({ query, execute });
  const database = partial<AgentSessionDatabase>({
    query,
    execute,
    transaction: async (work) => work(transaction),
  });
  mocks.write.mockResolvedValue("file");
  mocks.prepare.mockResolvedValue([]);
  mocks.append.mockResolvedValue(undefined);
  return {
    repository: new AgentSessionEventRepository(database),
    query,
    execute,
  };
}

describe("session event journal", () => {
  it("deduplicates events and publishes numbered text with a sanitized file body", async () => {
    const { repository, query, execute } = fixture();
    query
      .mockResolvedValueOnce([[3, "step", "launch", "plan"]])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([[3, "step", "launch"]])
      .mockResolvedValueOnce([]);
    const stored = await repository.appendEvents("attempt", [event, event], 20);
    expect(stored).toMatchObject([
      { sequence: 3, text: event.text, stepId: "step" },
    ]);
    expect(mocks.write).toHaveBeenCalledWith("plan", "helloworld");
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("refuses missing attempts and retries conflicting sequence changes", async () => {
    const { repository, query } = fixture();
    query.mockResolvedValueOnce([]);
    await expect(repository.appendEvents("attempt", [], 10)).rejects.toThrow(
      "Unknown PageAgentCLI attempt",
    );
    for (let index = 0; index < 5; index += 1)
      query
        .mockResolvedValueOnce([[1, "step", "launch", "plan"]])
        .mockResolvedValueOnce([[2, "step", "launch"]]);
    await expect(repository.appendEvents("attempt", [], 10)).rejects.toThrow();
  });

  it("reads journal windows and preserves retention boundaries", async () => {
    const { repository, query } = fixture();
    mocks.read.mockResolvedValue(null);
    mocks.row
      .mockResolvedValueOnce({ sequence: 3 })
      .mockResolvedValueOnce({ sequence: 4 });
    query
      .mockResolvedValueOnce([["first"], ["second"]])
      .mockResolvedValueOnce([[3]]);
    await expect(
      repository.readWindow("attempt", { after: 0, limit: 1 }),
    ).resolves.toMatchObject({
      events: [{ sequence: 3 }],
      cursor: 3,
      hasMore: true,
      retainedFrom: 3,
    });
    const archived = {
      events: [],
      cursor: null,
      hasMore: false,
      hasEarlier: false,
      retainedFrom: null,
      source: "journal",
    };
    mocks.read.mockResolvedValueOnce(archived);
    await expect(
      repository.readWindow("attempt", { after: 0, limit: 1 }),
    ).resolves.toEqual(archived);
  });
});
