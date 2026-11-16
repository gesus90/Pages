import { expect, it, vi } from "vitest";

import { LiveChangeAudience } from "@/backend/service/events/LiveChangeAudience";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { LiveChangeAudienceDependencies } from "@/backend/service/events/LiveChangeAudience";
import type { User } from "@/definition/User";

const USER = partial<User>({ id: "user" });

it("decides each event through its corresponding current visibility boundary", async () => {
  const dependencies = partial<LiveChangeAudienceDependencies>({
    wiki: { canView: vi.fn(async () => true) },
    conversations: { isMember: vi.fn(async () => false) },
    calendar: { isAffected: vi.fn(async () => true) },
    milestones: {
      findMilestoneById: vi.fn(async () => ({ projectId: "project" })),
    },
    projects: { getById: vi.fn(async () => ({})) },
    tickets: { getById: vi.fn(async () => ({})) },
  });
  const audience = new LiveChangeAudience(dependencies);
  await expect(
    audience.notice(USER, { type: "wiki.page.updated", id: "page" }),
  ).resolves.toEqual({ kind: "wiki", id: "page" });
  await expect(
    audience.notice(USER, { type: "conversation.changed", id: "chat" }),
  ).resolves.toBeNull();
  await expect(
    audience.notice(USER, { type: "calendar.changed", id: "event" }),
  ).resolves.toEqual({ kind: "calendar", id: "event" });
  await expect(
    audience.notice(USER, { type: "milestone.updated", id: "milestone" }),
  ).resolves.toEqual({ kind: "milestone", id: "milestone" });
  await expect(
    audience.notice(USER, { type: "project.tickets.changed", id: "project" }),
  ).resolves.toEqual({ kind: "project", id: "project" });
  await expect(
    audience.notice(USER, { type: "ticket.updated", id: "ticket" }),
  ).resolves.toEqual({ kind: "ticket", id: "ticket" });
  await expect(
    audience.notice(USER, { type: "asset.linked", id: "asset" }),
  ).resolves.toBeNull();
});

it("does not reveal deleted tickets outside the reader's prior scope or on read failure", async () => {
  const visibility = vi.fn(async () => ({
    departmentIds: ["department"],
    projectIds: ["project"],
  }));
  const getById = vi.fn(async () => ({}));
  const audience = new LiveChangeAudience(
    partial<LiveChangeAudienceDependencies>({
      projects: { workItemVisibility: visibility, getById },
    }),
  );
  const event = {
    type: "ticket.deleted" as const,
    id: "ticket",
    audience: { projectId: "project", departmentIds: ["department"] },
  };
  await expect(audience.notice(USER, event)).resolves.toEqual({
    kind: "ticket",
    id: "ticket",
  });
  await expect(
    audience.notice(USER, {
      ...event,
      audience: { ...event.audience, departmentIds: ["other"] },
    }),
  ).resolves.toBeNull();
  await expect(
    audience.notice(USER, {
      ...event,
      audience: { ...event.audience, projectId: "other" },
    }),
  ).resolves.toBeNull();
  getById.mockRejectedValueOnce(new Error("unavailable"));
  await expect(audience.notice(USER, event)).resolves.toBeNull();
});
