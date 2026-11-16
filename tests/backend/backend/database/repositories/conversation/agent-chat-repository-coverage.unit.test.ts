import { expect, it, vi } from "vitest";

import { ConversationAgentChatRepository } from "@/backend/database/repositories/conversation/ConversationAgentChatRepository";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { Database } from "@/backend/database/Database";

it("maps counts, empty results and agent-only conversation rows", async () => {
  const query = vi
    .fn<Database["query"]>()
    .mockResolvedValueOnce([[3]])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      ["one", "group", "Group", "2026-01-01"],
      ["two", "direct", "Direct", "2026-01-02"],
    ])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([["member"]]);
  const repository = new ConversationAgentChatRepository(partial({ query }));
  await expect(repository.chainLength("one")).resolves.toBe(3);
  await expect(repository.sentSince("agent", "time", "prefix")).resolves.toBe(
    0,
  );
  await expect(repository.listAgentOnly([], 10)).resolves.toEqual([]);
  expect(query).toHaveBeenCalledTimes(2);
  await expect(repository.listAgentOnly(["agent"], 10)).resolves.toEqual([
    { id: "one", kind: "group", name: "Group", lastActivityAt: "2026-01-01" },
    { id: "two", kind: "direct", name: "Direct", lastActivityAt: "2026-01-02" },
  ]);
  expect(query.mock.calls[2]?.[1]).toMatchObject({ limit: 10 });
  await expect(repository.findAgentOnly("missing")).resolves.toBeNull();
  await expect(repository.projectMemberIds("manager")).resolves.toEqual([
    "member",
  ]);
});
