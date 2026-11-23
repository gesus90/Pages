import { expect, it, vi } from "vitest";

import { CalendarParticipationRepository } from "./CalendarParticipationRepository";

import type { CalendarDatabase } from "./CalendarEventRepository";

function doubleOf(rows: unknown[][] = []): {
  repository: CalendarParticipationRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  return {
    repository: new CalendarParticipationRepository({
      query,
      execute,
    } as unknown as CalendarDatabase),
    query,
    execute,
  };
}

it("reads invitations and skips unknown kinds", async () => {
  const { repository } = doubleOf([
    ["e1", "person", "u1"],
    ["e1", "mystery", "u2"],
  ]);

  await expect(repository.findInvitations(["e1"])).resolves.toEqual([
    { eventId: "e1", kind: "person", inviteeId: "u1" },
  ]);
});

it("replaces invitations with their positions", async () => {
  const { repository, execute } = doubleOf();

  await repository.replaceInvitations("e1", [
    { kind: "person", id: "u1" },
    { kind: "group", id: "g1" },
  ]);

  expect(execute).toHaveBeenCalledTimes(3);
  expect(execute.mock.calls[1]?.[1]).toEqual({
    event_id: "e1",
    invitee_kind: "person",
    invitee_id: "u1",
    position: 0,
  });
  expect(execute.mock.calls[2]?.[1]).toMatchObject({ position: 1 });
});

it("clears the invitations for an empty list", async () => {
  const { repository, execute } = doubleOf();

  await repository.replaceInvitations("e1", []);

  expect(execute).toHaveBeenCalledTimes(1);
});

it("reads answers and rejects an invalid one", async () => {
  const valid = doubleOf([
    ["e1", "u1", "accepted"],
    ["e1", "u2", "declined"],
  ]);
  const invalid = doubleOf([["e1", "u1", "maybe"]]);

  await expect(valid.repository.findResponses(["e1"])).resolves.toEqual([
    { eventId: "e1", userId: "u1", response: "accepted" },
    { eventId: "e1", userId: "u2", response: "declined" },
  ]);
  await expect(invalid.repository.findResponses(["e1"])).rejects.toThrow(
    "response",
  );
});

it("saves, copies and reopens answers", async () => {
  const { repository, execute } = doubleOf();

  await repository.saveResponse({
    eventId: "e1",
    userId: "u1",
    response: "accepted",
  });
  await repository.copyResponses("e1", "e2");
  await repository.reopenAcceptances("e1");

  expect(execute.mock.calls.map((call) => call[1])).toEqual([
    { event_id: "e1", user_id: "u1", response: "accepted" },
    { from_event_id: "e1", to_event_id: "e2" },
    { event_id: "e1" },
  ]);
});

it("checks the membership for a project calendar", async () => {
  const member = doubleOf([[1]]);
  const stranger = doubleOf();

  await expect(member.repository.isAffected("u1", "project:p1")).resolves.toBe(
    true,
  );
  await expect(
    stranger.repository.isAffected("u1", "project:p1"),
  ).resolves.toBe(false);
  expect(member.query.mock.calls[0]?.[1]).toEqual({
    project_id: "p1",
    user_id: "u1",
  });
});

it("checks whether an event concerns an account", async () => {
  const affected = doubleOf([[1]]);
  const unaffected = doubleOf();

  await expect(affected.repository.isAffected("u1", "e1")).resolves.toBe(true);
  await expect(unaffected.repository.isAffected("u1", "e1")).resolves.toBe(
    false,
  );
  expect(affected.query.mock.calls[0]?.[1]).toEqual({
    event_id: "e1",
    user_id: "u1",
  });
});

it("finds a stored operation or returns null", async () => {
  const found = doubleOf([["digest", "{}"]]);
  const missing = doubleOf();

  await expect(found.repository.findOperation("a", "o")).resolves.toEqual({
    requestDigest: "digest",
    response: "{}",
  });
  await expect(missing.repository.findOperation("a", "o")).resolves.toBeNull();
});

it("saves an operation", async () => {
  const { repository, execute } = doubleOf();

  await repository.saveOperation("a", "o", {
    requestDigest: "digest",
    response: "{}",
  });

  expect(execute.mock.calls[0]?.[1]).toEqual({
    account_id: "a",
    operation_id: "o",
    request_digest: "digest",
    response: "{}",
  });
});
