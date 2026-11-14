import { expect, it, vi } from "vitest";

import { ConversationRoundRepository } from "@/backend/database/repositories/conversation/ConversationRoundRepository";
import { CONVERSATION_OBSERVER_LIMITS } from "@/definition/ConversationObserver";

import type {
  DatabaseTransaction,
  DatabaseValue,
  SqlParameters,
} from "@/backend/database/Database";
import type { ConversationReplyClaim } from "@/backend/database/repositories/conversation/ConversationRoundRepository";

function fixture(): ConversationRoundRepository {
  const targets = new Set<string>();
  let automaticCount = 0;
  const query = vi.fn(
    async (
      statement: string,
      parameters?: SqlParameters,
    ): Promise<readonly DatabaseValue[][]> => {
      const key = `${String(parameters?.trigger_message_id)}:${String(parameters?.agent_id)}`;
      if (statement.includes("SELECT automatic_count"))
        return [[automaticCount]];
      if (statement.includes("FROM conversation_follow_up_answers")) return [];
      if (statement.includes("SELECT agent_id"))
        return targets.has(key) ? [["agent"]] : [];
      if (statement.includes("INSERT INTO conversation_reply_targets")) {
        if (targets.has(key)) return [];
        targets.add(key);
        return [["agent"]];
      }
      throw new Error("Unexpected repository query");
    },
  );
  const execute = vi.fn(async (statement: string): Promise<void> => {
    if (statement.includes("automatic_count = automatic_count + 1"))
      automaticCount++;
  });
  const transaction: DatabaseTransaction = { query, execute };
  return new ConversationRoundRepository({
    query,
    execute,
    transaction: async (work) => work(transaction),
  });
}

function claim(agentId: string, isAutomatic = false): ConversationReplyClaim {
  return {
    agentId,
    isAutomatic,
    originMessageId: "origin",
    conversationId: "group",
    personId: "person",
    createdAt: "today",
    trigger: isAutomatic ? "handoff" : "mention",
    triggerMessageId: "origin",
    requestedBy: null,
    reason: "",
  };
}

it("PAGE-326 permits each explicit collective recipient once per origin, even beyond the automatic limit", async () => {
  const rounds = fixture();
  for (
    let index = 0;
    index < CONVERSATION_OBSERVER_LIMITS.automaticRepliesPerOrigin;
    index++
  )
    expect(await rounds.claim(claim(`automatic-${index}`, true))).toBe(
      "claimed",
    );
  expect(await rounds.claim(claim("one-more", true))).toBe("limit");
  for (const id of ["ed", "bakuman", "conan", "all-might", "mei"]) {
    expect(await rounds.claim(claim(id))).toBe("claimed");
    expect(await rounds.claim(claim(id))).toBe("duplicate");
    expect(await rounds.claim(claim(id, true))).toBe("duplicate");
  }
  expect(
    await rounds.claim({
      ...claim("ed"),
      originMessageId: "next-origin",
      triggerMessageId: "next-origin",
    }),
  ).toBe("claimed");
});
