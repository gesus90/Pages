import { describe, expect, it, vi } from "vitest";

import { CalendarPeople } from "./CalendarPeople";

import type { CalendarEventRecord } from "@/backend/database/repositories/calendar/CalendarEventRepository";

function eventOf(id: string, createdBy = "owner"): CalendarEventRecord {
  return {
    id,
    title: "T",
    description: "",
    allDay: false,
    startAt: "2030-01-01T10:00:00Z",
    endAt: "2030-01-01T11:00:00Z",
    timeZone: "UTC",
    projectId: null,
    createdBy,
    revision: 1,
    deletedAt: null,
    recurrence: null,
  };
}

const account = (
  id: string,
  name: string,
  flags: { isAgent?: boolean; isActive?: boolean } = {},
): object => ({
  id,
  name,
  isAgent: flags.isAgent ?? false,
  isActive: flags.isActive ?? true,
});

interface PeopleFixture {
  readonly people: CalendarPeople;
  readonly repositories: {
    readonly participation: { findInvitations: ReturnType<typeof vi.fn> };
    readonly directory: { findGroupMembers: ReturnType<typeof vi.fn> };
  };
}

async function readPeople(
  events: readonly CalendarEventRecord[],
): Promise<PeopleFixture> {
  const repositories = {
    participation: {
      findInvitations: vi.fn(async () => [
        { eventId: "e1", kind: "person", inviteeId: "ann" },
        { eventId: "e1", kind: "person", inviteeId: "gone" },
        { eventId: "e1", kind: "person", inviteeId: "owner" },
        { eventId: "e1", kind: "agent", inviteeId: "bot" },
        { eventId: "e1", kind: "group", inviteeId: "g1" },
        { eventId: "e1", kind: "group", inviteeId: "g-empty" },
        { eventId: "e1", kind: "department", inviteeId: "d1" },
        { eventId: "e1", kind: "department", inviteeId: "d-empty" },
        { eventId: "e1", kind: "person", inviteeId: "unknown" },
      ]),
      findResponses: vi.fn(async () => [
        { eventId: "e1", userId: "ann", response: "accepted" },
        { eventId: "e1", userId: "bot", response: "declined" },
      ]),
    },
    directory: {
      findAccounts: vi.fn(async () => [
        account("owner", "Owner"),
        account("ann", "Ann"),
        account("gone", "Gone", { isActive: false }),
        account("bot", "Bot", { isAgent: true }),
        account("gm", "Gm"),
        account("dm", "Dm"),
      ]),
      findGroups: vi.fn(async () => [
        { id: "g1", name: "Group" },
        { id: "g-empty", name: "Empty group" },
      ]),
      findDepartments: vi.fn(async () => [
        { id: "d1", name: "Department" },
        { id: "d-empty", name: "Empty department" },
      ]),
      findGroupMembers: vi.fn(async () => [
        { containerId: "g1", userId: "gm" },
        { containerId: "g1", userId: "ann" },
        { containerId: "g1", userId: "ghost" },
      ]),
      findDepartmentMembers: vi.fn(async () => [
        { containerId: "d1", userId: "dm" },
      ]),
    },
  };
  const people = await CalendarPeople.read(
    repositories as unknown as Parameters<typeof CalendarPeople.read>[0],
    events,
  );
  return { people, repositories };
}

describe("CalendarPeople", () => {
  it("reads invitations, answers and members of the events", async () => {
    const { repositories } = await readPeople([eventOf("e1")]);

    expect(repositories.participation.findInvitations).toHaveBeenCalledWith([
      "e1",
    ]);
    expect(repositories.directory.findGroupMembers).toHaveBeenCalledWith([
      "g1",
      "g-empty",
    ]);
  });

  it("names invitees and skips those without a name", async () => {
    const { people } = await readPeople([eventOf("e1")]);

    expect(people.of(eventOf("e1")).invitees).toEqual([
      { kind: "person", id: "ann", name: "Ann" },
      { kind: "person", id: "gone", name: "Gone" },
      { kind: "person", id: "owner", name: "Owner" },
      { kind: "agent", id: "bot", name: "Bot" },
      { kind: "group", id: "g1", name: "Group" },
      { kind: "group", id: "g-empty", name: "Empty group" },
      { kind: "department", id: "d1", name: "Department" },
      { kind: "department", id: "d-empty", name: "Empty department" },
    ]);
  });

  it("resolves the affected accounts without the creator or inactive ones", async () => {
    const { people } = await readPeople([eventOf("e1")]);
    const participants = people.of(eventOf("e1"));

    expect([...participants.affectedIds].sort()).toEqual([
      "ann",
      "bot",
      "dm",
      "ghost",
      "gm",
    ]);
    expect(participants.responses).toEqual([
      { userId: "ann", name: "Ann", response: "accepted" },
      { userId: "bot", name: "Bot", response: "open" },
      { userId: "dm", name: "Dm", response: "open" },
      { userId: "gm", name: "Gm", response: "open" },
    ]);
    expect(participants.createdBy).toEqual({ id: "owner", name: "Owner" });
  });

  it("returns empty participants and a placeholder for an unknown creator", async () => {
    const { people } = await readPeople([eventOf("e1")]);
    const participants = people.of(eventOf("e2", "stranger"));

    expect(participants.invitees).toEqual([]);
    expect(participants.responses).toEqual([]);
    expect(participants.createdBy).toEqual({ id: "stranger", name: "—" });
  });

  it("tells agents from persons and unknown accounts", async () => {
    const { people } = await readPeople([eventOf("e1")]);

    expect(people.isAgent("bot")).toBe(true);
    expect(people.isAgent("ann")).toBe(false);
    expect(people.isAgent("nobody")).toBe(false);
  });
});
