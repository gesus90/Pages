import { expect, it, vi } from "vitest";

import { LiveChangeAudience } from "@/backend/service/events/LiveChangeAudience";
import { readRelayedEvent } from "@/backend/service/events/LiveChangeRelay";
import { isPagesEventType } from "@/backend/service/events/PagesEventPublisher";
import { readLiveChange } from "@/definition/LiveChange";

import type { User } from "@/definition/User";

const USER: User = {
  id: "bob",
  username: "bob",
  displayName: "Bob",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};

function audience(isAffected: (actor: User, id: string) => Promise<boolean>): LiveChangeAudience {
  const refuse = vi.fn(async () => {
    throw new Error("not used");
  });
  return new LiveChangeAudience({
    tickets: { getById: refuse },
    milestones: { findMilestoneById: refuse },
    projects: { getById: refuse, workItemVisibility: refuse },
    wiki: { canView: refuse },
    conversations: { isMember: refuse },
    calendar: { isAffected },
  });
}

it("announces a calendar change only to affected accounts", async () => {
  const isAffected = vi.fn(async (_actor: User, id: string) => id === "event-1");
  const check = audience(isAffected);

  await expect(check.notice(USER, { type: "calendar.changed", id: "event-1" })).resolves.toEqual({
    kind: "calendar",
    id: "event-1",
  });
  await expect(check.notice(USER, { type: "calendar.changed", id: "event-2" })).resolves.toBeNull();
  expect(isAffected).toHaveBeenCalledWith(USER, "event-2");
});

it("knows the calendar event type in the outbox, the relay and the browser", () => {
  expect(isPagesEventType("calendar.changed")).toBe(true);
  expect(readRelayedEvent(JSON.stringify({ type: "calendar.changed", id: "project:p1" }))).toEqual({
    type: "calendar.changed",
    id: "project:p1",
  });
  expect(readLiveChange(JSON.stringify({ kind: "calendar", id: "event-1" }))).toEqual({
    kind: "calendar",
    id: "event-1",
  });
});
