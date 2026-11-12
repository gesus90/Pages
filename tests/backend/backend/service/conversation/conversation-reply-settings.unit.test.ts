import { expect, it, vi } from "vitest";

import { ConversationReplySettingsRepository } from "@/backend/database/repositories/conversation/ConversationReplySettingsRepository";
import { ConversationReplySettingsService } from "@/backend/service/conversation/ConversationReplySettingsService";
import { ConversationAccounts } from "@/backend/service/conversation/ConversationDirectory";

import type { User } from "@/definition/User";

const person: User = {
  id: "person",
  username: "person",
  displayName: "Person",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const input = {
  conversationId: "group",
  mode: "mentions",
  defaultResponderId: null,
  maximumResponders: 2,
  repliesPerAgentPerOrigin: 4,
  automaticRepliesPerOrigin: 8,
} as const;

function fixture(): {
  service: ConversationReplySettingsService;
  settings: ConversationReplySettingsRepository;
  createdBy: ReturnType<typeof vi.fn>;
} {
  const settings = new ConversationReplySettingsRepository({
    query: vi.fn(),
    execute: vi.fn(),
  });
  vi.spyOn(settings, "find").mockResolvedValue({
    ...input,
    repliesPerAgentPerOrigin: 2,
    automaticRepliesPerOrigin: 6,
  });
  vi.spyOn(settings, "save").mockResolvedValue(undefined);
  const createdBy = vi.fn().mockResolvedValue(person.id);
  return {
    settings,
    createdBy,
    service: new ConversationReplySettingsService({
      settings,
      conversations: {
        findForMember: vi.fn().mockResolvedValue({ kind: "group" }),
        createdBy,
        memberIds: vi.fn().mockResolvedValue(new Map()),
      },
      directory: {
        read: vi.fn().mockResolvedValue(new ConversationAccounts(new Map())),
      },
      publisher: { publish: vi.fn() },
    }),
  };
}

it("saves valid group limits and preserves them for clients that omit the new fields", async () => {
  const { service, settings } = fixture();
  expect(
    await service.save(person, { ...input, automaticRepliesPerOrigin: 9 }),
  ).toMatchObject({
    repliesPerAgentPerOrigin: 4,
    automaticRepliesPerOrigin: 9,
  });
  const legacy = {
    conversationId: "group",
    mode: "mentions",
    defaultResponderId: null,
    maximumResponders: 2,
  };
  expect(await service.save(person, legacy)).toMatchObject({
    repliesPerAgentPerOrigin: 2,
    automaticRepliesPerOrigin: 6,
  });
  expect(settings.save).toHaveBeenCalledTimes(2);
});

it.each([
  { repliesPerAgentPerOrigin: 5 },
  { repliesPerAgentPerOrigin: 0 },
  { automaticRepliesPerOrigin: 10 },
  { automaticRepliesPerOrigin: 1.5 },
])("rejects unsafe or invalid round limits: %s", async (limits) => {
  const { service, settings } = fixture();
  await expect(
    service.save(person, { ...input, ...limits }),
  ).rejects.toMatchObject({ code: "invalid" });
  expect(settings.save).not.toHaveBeenCalled();
});

it("keeps the existing group management authorization for both limits", async () => {
  const { service, settings, createdBy } = fixture();
  createdBy.mockResolvedValue("another-person");
  await expect(service.save(person, input)).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(settings.save).not.toHaveBeenCalled();
});
