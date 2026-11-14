import { expect, it, vi } from "vitest";

import { ConversationError } from "@/backend/error/ConversationError";
import { ChatViewPreferenceService } from "@/backend/service/conversation/content/ChatViewPreferenceService";

import { EMPLOYEE as PERSON } from "../../../../app/server-lib/request-fixtures";

import type { ChatViewPreferenceRepository } from "@/backend/database/repositories/conversation/ChatViewPreferenceRepository";

const NOW = new Date("2026-11-13T10:00:00.000Z");

function repositoryDouble(): {
  readonly repository: ChatViewPreferenceRepository;
  readonly setListCollapsed: ReturnType<typeof vi.fn>;
} {
  const setListCollapsed = vi.fn().mockResolvedValue(undefined);
  const repository = {
    cardStates: vi.fn().mockResolvedValue({ card: "collapsed" }),
    splitWidth: vi.fn().mockResolvedValue(null),
    isListCollapsed: vi.fn().mockResolvedValue(true),
    setListCollapsed,
  } as unknown as ChatViewPreferenceRepository;
  return { repository, setListCollapsed };
}

it("reads the list state with the card states and the split width (PAGE-325)", async () => {
  const { repository } = repositoryDouble();
  const service = new ChatViewPreferenceService(repository, () => NOW);

  await expect(service.read(PERSON)).resolves.toEqual({
    cardStates: { card: "collapsed" },
    splitWidth: null,
    isListCollapsed: true,
  });
});

it("stores the list state from the form and refuses anything else", async () => {
  const { repository, setListCollapsed } = repositoryDouble();
  const service = new ChatViewPreferenceService(repository, () => NOW);

  await service.setListCollapsed(PERSON, "true");
  await service.setListCollapsed(PERSON, "false");
  expect(setListCollapsed.mock.calls).toEqual([
    ["employee", true, "2026-11-13T10:00:00.000Z"],
    ["employee", false, "2026-11-13T10:00:00.000Z"],
  ]);

  for (const input of ["1", "yes", null, true])
    await expect(service.setListCollapsed(PERSON, input)).rejects.toEqual(
      new ConversationError("invalid"),
    );
  expect(setListCollapsed).toHaveBeenCalledTimes(2);
});

it("stores valid card and split choices and rejects invalid choices", async () => {
  const setCardState = vi.fn().mockResolvedValue(undefined);
  const setSplitWidth = vi.fn().mockResolvedValue(undefined);
  const { repository } = repositoryDouble();
  Object.assign(repository, { setCardState, setSplitWidth });
  const service = new ChatViewPreferenceService(repository, () => NOW);

  await service.setCardState(PERSON, { cardKey: "link:1", state: "expanded" });
  await service.setSplitWidth(PERSON, "420");
  expect(setCardState).toHaveBeenCalledWith(PERSON.id, {
    cardKey: "link:1",
    state: "expanded",
    updatedAt: NOW.toISOString(),
  });
  expect(setSplitWidth).toHaveBeenCalledWith(PERSON.id, 420, NOW.toISOString());
  await expect(
    service.setCardState(PERSON, { cardKey: "bad key", state: "expanded" }),
  ).rejects.toEqual(new ConversationError("invalid"));
  await expect(service.setSplitWidth(PERSON, 359)).rejects.toEqual(
    new ConversationError("invalid"),
  );
  expect(setCardState).toHaveBeenCalledTimes(1);
  expect(setSplitWidth).toHaveBeenCalledTimes(1);
});
