import { expect, it, vi } from "vitest";

import { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";

it("PAGE-344 counts missing original messages only within the answered range", async () => {
  const query = vi.fn().mockResolvedValue([[10]]);
  const messages = new ConversationMessageRepository({
    query,
    transaction: vi.fn(),
  });
  await expect(
    messages.contextCount("group", { afterSequence: 5, throughSequence: 35 }),
  ).resolves.toBe(10);
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining("notice IS NULL"),
    { conversation_id: "group", after_sequence: 5, through_sequence: 35 },
  );
  expect(query.mock.calls[0]?.[0]).toContain("sequence > $after_sequence");
  expect(query.mock.calls[0]?.[0]).toContain("sequence <= $through_sequence");
});
