import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { NewConversation } from "@/backend/database/repositories/conversation/ConversationRepository";
import type { PagesEventRecord } from "@/backend/database/repositories/events/PagesEventOutboxRepository";

const append = vi.hoisted(() => vi.fn());
vi.mock(
  "@/backend/database/repositories/events/PagesEventOutboxRepository",
  () => ({
    PagesEventOutboxRepository: class {
      public append = append;
    },
  }),
);

import { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";

const query = vi.fn();
const execute = vi.fn();
const transaction = partial<DatabaseTransaction>({ query, execute });
const database = partial<Database>({
  query,
  execute,
  transaction: async (work) => work(transaction),
});
const repository = new ConversationRepository(database);
const conversation: NewConversation = {
  id: "conversation",
  kind: "direct",
  name: "",
  directKey: "a:b",
  createdBy: "a",
  createdAt: "now",
  memberIds: ["a", "b"],
};
const event = partial<PagesEventRecord>({});

beforeEach(() => {
  vi.resetAllMocks();
  query.mockResolvedValue([]);
});

it("stores new direct conversations with members and an outbox event", async () => {
  query.mockResolvedValueOnce([["conversation"]]);
  expect(await repository.create(conversation, event)).toEqual({
    id: "conversation",
    isNew: true,
  });
  expect(execute).toHaveBeenCalledTimes(2);
  expect(append).toHaveBeenCalledWith(event);
});

it("returns the existing direct conversation without adding members again", async () => {
  query.mockResolvedValueOnce([]).mockResolvedValueOnce([["existing"]]);
  expect(await repository.create(conversation, event)).toEqual({
    id: "existing",
    isNew: false,
  });
  expect(execute).not.toHaveBeenCalled();
  expect(append).not.toHaveBeenCalled();
});

it("reads only a member's view and binds paging positions", async () => {
  query.mockResolvedValue([["conversation", "group", "Group", "now", 1, 3]]);
  expect(await repository.findForMember("conversation", "user")).toEqual({
    id: "conversation",
    kind: "group",
    name: "Group",
    lastActivityAt: "now",
    isMuted: true,
    unreadCount: 3,
  });
  await repository.listForMember(
    "user",
    { id: "previous", lastActivityAt: "before" },
    10,
  );
  expect(query).toHaveBeenLastCalledWith(expect.any(String), {
    user_id: "user",
    after_activity: "before",
    after_id: "previous",
    limit: 10,
  });
});

it("groups member IDs and avoids querying an empty list", async () => {
  expect((await repository.memberIds([])).size).toBe(0);
  expect(query).not.toHaveBeenCalled();
  query.mockResolvedValue([
    ["conversation", "a"],
    ["conversation", "b"],
  ]);
  expect(
    (await repository.memberIds(["conversation"])).get("conversation"),
  ).toEqual(["a", "b"]);
});
