import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { isResyncEvent, LiveChangeAudience } from "./LiveChangeAudience";

import type { LiveChangeAudienceDependencies } from "./LiveChangeAudience";
import type { PagesEvent } from "./PagesEventPublisher";
import type { WorkItemVisibility } from "@/definition/Task";
import type { User } from "@/definition/User";

const logger = vi.hoisted(() => ({ logCaughtError: vi.fn() }));

vi.mock("@/backend/logging/Logger", () => logger);

const actor = { id: "u" } as unknown as User;

function build(
  overrides: {
    visibility?: WorkItemVisibility;
    withCalendar?: boolean;
    milestone?: { projectId: string } | null;
  } = {},
): {
  audience: LiveChangeAudience;
  mocks: Record<string, Mock<() => Promise<unknown>>>;
} {
  const mocks = {
    ticket: vi.fn(() => Promise.resolve({})),
    milestone: vi.fn(() =>
      Promise.resolve(
        overrides.milestone === undefined
          ? { projectId: "p" }
          : overrides.milestone,
      ),
    ),
    project: vi.fn(() => Promise.resolve({})),
    visibility: vi.fn(() =>
      Promise.resolve(overrides.visibility ?? { departmentIds: null }),
    ),
    canView: vi.fn(() => Promise.resolve(true)),
    isMember: vi.fn(() => Promise.resolve(true)),
    isAffected: vi.fn(() => Promise.resolve(true)),
  };
  const dependencies = {
    tickets: { getById: mocks.ticket },
    milestones: { findMilestoneById: mocks.milestone },
    projects: {
      getById: mocks.project,
      workItemVisibility: mocks.visibility,
    },
    wiki: { canView: mocks.canView },
    conversations: { isMember: mocks.isMember },
    ...(overrides.withCalendar === false
      ? {}
      : { calendar: { isAffected: mocks.isAffected } }),
  } as unknown as LiveChangeAudienceDependencies;
  return { audience: new LiveChangeAudience(dependencies), mocks };
}

function event(
  type: PagesEvent["type"],
  extra: Partial<PagesEvent> = {},
): PagesEvent {
  return { type, id: "x", ...extra };
}

describe("isResyncEvent", () => {
  it("is true for purged pages and changed project access", () => {
    expect(isResyncEvent("wiki.page.purged")).toBe(true);
    expect(isResyncEvent("project.access.changed")).toBe(true);
    expect(isResyncEvent("ticket.updated")).toBe(false);
  });
});

describe("LiveChangeAudience.notice", () => {
  beforeEach(() => {
    logger.logCaughtError.mockReset();
  });

  it("always names the plan catalog", async () => {
    const { audience } = build();
    expect(await audience.notice(actor, event("plan.catalog.changed"))).toEqual(
      { kind: "plan", id: "catalog" },
    );
  });

  it("names nothing for kinds without a notice", async () => {
    const { audience } = build();
    expect(await audience.notice(actor, event("asset.linked"))).toBeNull();
  });

  it("decides wiki and conversation by their own checks", async () => {
    const { audience, mocks } = build();
    expect(await audience.notice(actor, event("wiki.page.updated"))).toEqual({
      kind: "wiki",
      id: "x",
    });
    mocks.canView.mockResolvedValueOnce(false);
    expect(await audience.notice(actor, event("wiki.page.updated"))).toBeNull();
    expect(await audience.notice(actor, event("conversation.changed"))).toEqual(
      { kind: "conversation", id: "x" },
    );
  });

  it("decides calendar events, also without a calendar check", async () => {
    const { audience } = build();
    expect(await audience.notice(actor, event("calendar.changed"))).toEqual({
      kind: "calendar",
      id: "x",
    });
    const bare = build({ withCalendar: false });
    expect(
      await bare.audience.notice(actor, event("calendar.changed")),
    ).toBeNull();
  });

  it("decides milestones through their project", async () => {
    const { audience, mocks } = build();
    expect(await audience.notice(actor, event("milestone.updated"))).toEqual({
      kind: "milestone",
      id: "x",
    });
    expect(mocks.project).toHaveBeenCalledWith(actor, "p");
    const gone = build({ milestone: null });
    expect(
      await gone.audience.notice(actor, event("milestone.updated")),
    ).toBeNull();
  });

  it("decides projects and tickets by reading them", async () => {
    const { audience, mocks } = build();
    expect(
      await audience.notice(actor, event("project.tickets.changed")),
    ).toEqual({ kind: "project", id: "x" });
    expect(await audience.notice(actor, event("ticket.updated"))).toEqual({
      kind: "ticket",
      id: "x",
    });
    expect(mocks.ticket).toHaveBeenCalledWith(actor, "x");
  });

  it("hides an event when a read fails and logs it", async () => {
    const { audience, mocks } = build();
    const failure = new Error("denied");
    mocks.ticket.mockRejectedValueOnce(failure);
    expect(await audience.notice(actor, event("ticket.updated"))).toBeNull();
    expect(logger.logCaughtError).toHaveBeenCalledWith(
      "LiveChangeAudience",
      failure,
    );
  });

  it("decides a deleted ticket by its audience", async () => {
    const audienceOf = { projectId: "p", departmentIds: ["d1"] };
    const deleted = event("ticket.deleted", { audience: audienceOf });
    const open = build();
    expect(await open.audience.notice(actor, deleted)).toEqual({
      kind: "ticket",
      id: "x",
    });
    const noDepartments = build({
      visibility: { projectIds: ["p"], departmentIds: ["d2"] },
    });
    expect(await noDepartments.audience.notice(actor, deleted)).toBeNull();
    const wrongProject = build({
      visibility: { projectIds: ["q"], departmentIds: ["d1"] },
    });
    expect(await wrongProject.audience.notice(actor, deleted)).toBeNull();
    const matching = build({
      visibility: { projectIds: ["p"], departmentIds: ["d1"] },
    });
    expect(await matching.audience.notice(actor, deleted)).not.toBeNull();
    const projectWide = event("ticket.deleted", {
      audience: { projectId: "p", departmentIds: [] },
    });
    const restricted = build({
      visibility: { projectIds: undefined, departmentIds: ["d9"] },
    });
    expect(await restricted.audience.notice(actor, projectWide)).not.toBeNull();
  });
});
