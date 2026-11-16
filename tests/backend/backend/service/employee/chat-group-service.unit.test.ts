import { beforeEach, expect, it, vi } from "vitest";

import { ChatGroupService } from "@/backend/service/employee/ChatGroupService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { ChatGroupDependencies } from "@/backend/service/employee/ChatGroupService";
import type { User } from "@/definition/User";

const listContacts = vi.fn();
const create = vi.fn();
const list = vi.fn();
const memberIds = vi.fn();
const addMember = vi.fn();
const touchGroup = vi.fn();
const touchContact = vi.fn();
const person = partial<User>({ id: "person" });
const service = new ChatGroupService(
  partial<ChatGroupDependencies>({
    store: {
      groups: () => ({ create, list, memberIds, addMember, touch: touchGroup }),
      contacts: () => ({ list: listContacts, touch: touchContact }),
    },
    now: () => new Date("2026-01-01T00:00:00Z"),
    createId: () => "group",
  }),
);

beforeEach(() => {
  vi.resetAllMocks();
  listContacts.mockResolvedValue([{ contactId: "a" }, { contactId: "b" }]);
  list.mockResolvedValue([{ id: "group" }]);
  memberIds.mockResolvedValue(["a"]);
  touchGroup.mockResolvedValue(true);
  touchContact.mockResolvedValue(true);
});

it("creates an owned group with normalized text and unique contacts", async () => {
  expect(
    await service.create(person, {
      name: " Team ",
      description: " Notes ",
      memberIds: ["a", "a", "b"],
    }),
  ).toBe("group");
  expect(create).toHaveBeenCalledWith("person", {
    id: "group",
    name: "Team",
    description: "Notes",
    memberIds: ["a", "b"],
    createdAt: "2026-01-01T00:00:00.000Z",
  });
});

it.each([
  { name: " ", description: "", memberIds: ["a"] },
  { name: "Team", description: "", memberIds: [] },
  { name: "Team", description: "", memberIds: ["hidden"] },
  { name: "Team", description: "", memberIds: [3] },
])("rejects invalid groups before saving", async (input) => {
  await expect(service.create(person, input)).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
});

it("finds only owned groups and adds a contact once", async () => {
  expect(await service.find(person, "group")).toEqual({ id: "group" });
  expect(await service.find(person, "other")).toBeNull();
  await service.addMember(person, "group", "a");
  expect(addMember).not.toHaveBeenCalled();
  await service.addMember(person, "group", "b");
  expect(addMember).toHaveBeenCalledWith(
    "person",
    "group",
    "b",
    "2026-01-01T00:00:00.000Z",
  );
  memberIds.mockResolvedValue(null);
  await expect(service.addMember(person, "missing", "a")).rejects.toThrow();
});

it("records activity for known contacts and groups only", async () => {
  await service.recordActivity(person, { kind: "group", id: "group" });
  await service.recordActivity(person, { kind: "participant", id: "a" });
  expect(touchGroup).toHaveBeenCalledOnce();
  expect(touchContact).toHaveBeenCalledOnce();
  touchContact.mockResolvedValue(false);
  await expect(
    service.recordActivity(person, { kind: "participant", id: "missing" }),
  ).rejects.toThrow();
});
