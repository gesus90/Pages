import { expect, it, vi } from "vitest";

import { WikiFeedService } from "./WikiFeedService";

import type { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import type { User } from "@/definition/User";
import type { WikiAccess } from "./WikiAccess";

const actor: User = {
  displayName: "Ann",
  id: "u1",
  isActive: true,
  mustChangePassword: false,
  role: "employee",
  username: "ann",
};

it("marks entries newer than the read time as unread", async () => {
  const collect = vi.fn(async () => [
    { at: "2026-01-02T00:00:00Z", id: "new" },
    { at: "2026-01-01T00:00:00Z", id: "old" },
  ]);
  const repository = {
    feed: {
      collect,
      findReadTime: vi.fn(async () => "2026-01-01T00:00:00Z"),
    },
  } as unknown as WikiRepository;
  const access = {
    resolve: vi.fn(async () => ({ scope: { userId: "u1" } })),
  } as unknown as WikiAccess;

  const items = await new WikiFeedService(repository, access).forMe(actor);

  expect(items.map((item) => item.isUnread)).toEqual([true, false]);
  expect(collect).toHaveBeenCalledWith(
    { userId: "u1" },
    expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  );
});

it("marks the feed of the actor as read", async () => {
  const markRead = vi.fn(async () => {});
  const repository = { feed: { markRead } } as unknown as WikiRepository;

  await new WikiFeedService(repository, {} as unknown as WikiAccess).markRead(
    actor,
  );

  expect(markRead).toHaveBeenCalledWith("u1");
});
