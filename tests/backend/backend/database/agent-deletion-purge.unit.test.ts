import { expect, it, vi } from "vitest";

import { AgentDeletionPurgeRepository } from "@/backend/database/repositories/employee/AgentDeletionPurgeRepository";

import type { Database } from "@/backend/database/Database";

it("queues cleanup names before removing private rows and records the purge", async () => {
  const query = vi
    .fn<Database["query"]>()
    .mockResolvedValueOnce([["session-id"]])
    .mockResolvedValueOnce([
      ["chat", "attachment"],
      ["plan", "asset"],
    ]);
  const execute = vi.fn<Database["execute"]>().mockResolvedValue(undefined);
  const repository = new AgentDeletionPurgeRepository({ query, execute });
  const result = await repository.purge("agent", "2026-01-01", "event");
  expect(result.entries).toEqual([
    { kind: "session", name: "session-id" },
    { kind: "chat", name: "attachment" },
    { kind: "plan", name: "asset" },
  ]);
  expect(execute.mock.calls.slice(0, 3).map((call) => call[1])).toEqual(
    result.entries,
  );
  expect(execute.mock.calls[3]?.[0]).toContain(
    "DELETE FROM agent_session_events",
  );
  expect(execute.mock.calls.at(-1)?.[0]).toContain(
    "UPDATE agent_deletions SET purged_at",
  );
  expect(execute.mock.calls.at(-1)?.[1]).toMatchObject({
    agent_id: "agent",
    now: "2026-01-01",
  });
});

it("reads and acknowledges queued cleanup and rejects unknown kinds", async () => {
  const query = vi
    .fn<Database["query"]>()
    .mockResolvedValueOnce([["voice", "recording"]])
    .mockResolvedValueOnce([["unknown", "file"]]);
  const execute = vi.fn<Database["execute"]>().mockResolvedValue(undefined);
  const repository = new AgentDeletionPurgeRepository({ query, execute });
  await expect(repository.pendingFiles()).resolves.toEqual({
    entries: [{ kind: "voice", name: "recording" }],
  });
  await repository.acknowledgeFile("voice", "recording");
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("DELETE FROM agent_deletion_files"),
    { kind: "voice", name: "recording" },
  );
  await expect(repository.pendingFiles()).rejects.toThrow(
    "Unknown agent deletion file kind",
  );
});
