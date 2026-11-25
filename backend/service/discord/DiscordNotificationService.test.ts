import { afterEach, describe, expect, it, vi } from "vitest";

import { DiscordNotificationService } from "./DiscordNotificationService";

import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { DiscordNotificationDependencies } from "./DiscordNotificationService";

const mocks = vi.hoisted(() => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
  withBackgroundDatabaseWork: vi.fn(),
}));

vi.mock("@/backend/database/executor/DatabaseWorkContext", () => ({
  withBackgroundDatabaseWork: mocks.withBackgroundDatabaseWork,
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: mocks.logCaughtError,
  logDiagnostic: mocks.logDiagnostic,
}));

const NOW = new Date("2026-01-02T03:04:05.000Z");
const ALL_EVENTS = {
  "milestone.created": true,
  "milestone.updated": true,
  "ticket.created": true,
  "ticket.updated": true,
};

afterEach(() => {
  vi.clearAllMocks();
});

function createService(overrides: Partial<DiscordNotificationDependencies>): {
  readonly service: DiscordNotificationService;
  readonly enqueueDelivery: ReturnType<typeof vi.fn>;
  readonly findTicket: ReturnType<typeof vi.fn>;
  readonly findMilestone: ReturnType<typeof vi.fn>;
  readonly findConnection: ReturnType<typeof vi.fn>;
} {
  const enqueueDelivery = vi.fn().mockResolvedValue(undefined);
  const findTicket = vi.fn();
  const findMilestone = vi.fn();
  const findConnection = vi.fn().mockResolvedValue({
    baseUrl: "https://pages.example",
    events: ALL_EVENTS,
  });

  return {
    enqueueDelivery,
    findConnection,
    findMilestone,
    findTicket,
    service: new DiscordNotificationService({
      connections: { findConnection },
      deliveries: { enqueueDelivery },
      now: () => NOW,
      subjects: { findMilestone, findTicket },
      ...overrides,
    }),
  };
}

const ticketFacts = {
  hasDepartment: false,
  key: "TICKET-7",
  projectId: "p1",
  projectName: "Project",
  statusName: "Open",
  title: "Title",
};

describe("DiscordNotificationService.handle", () => {
  it("ignores events that are no Discord events", async () => {
    const { service, findTicket } = createService({});
    const event: PagesEvent = { id: "1", type: "ticket.deleted" };

    await service.handle(event);

    expect(findTicket).not.toHaveBeenCalled();
  });

  it("stores a message for a ticket and signals the delivery", async () => {
    const onEnqueued = vi.fn();
    const { service, findTicket, enqueueDelivery } = createService({
      onEnqueued,
    });

    findTicket.mockResolvedValue(ticketFacts);
    await service.handle({ id: "t1", type: "ticket.created" });

    expect(enqueueDelivery).toHaveBeenCalledTimes(1);

    const stored = enqueueDelivery.mock.calls[0]?.[0] as {
      readonly contentJson: string;
      readonly id: string;
      readonly [key: string]: unknown;
    };

    expect(stored).toMatchObject({
      eventType: "ticket.created",
      now: NOW.toISOString(),
      projectId: "p1",
      subjectKey: "/tasks/TICKET-7",
    });
    expect(JSON.parse(stored.contentJson)).toEqual({
      event: "ticket.created",
      projectName: "Project",
      reference: "TICKET-7",
      status: "Open",
      title: "Title",
      url: "https://pages.example/tasks/TICKET-7",
    });
    expect(onEnqueued).toHaveBeenCalledTimes(1);
  });

  it("stores a message for a milestone without a callback", async () => {
    const { service, findMilestone, enqueueDelivery } = createService({});

    findMilestone.mockResolvedValue({
      name: "Release",
      projectId: "p 1",
      projectName: "Project",
      status: "open",
    });
    await service.handle({ id: "m1", type: "milestone.updated" });

    const stored = enqueueDelivery.mock.calls[0]?.[0] as {
      readonly contentJson: string;
    };

    expect(stored).toMatchObject({
      eventType: "milestone.updated",
      subjectKey: "/projekte/p%201?tab=planning",
    });
    expect(JSON.parse(stored.contentJson)).toMatchObject({
      reference: null,
      title: "Release",
      url: "https://pages.example/projekte/p%201?tab=planning",
    });
  });

  it("skips a ticket that does not exist", async () => {
    const { service, findTicket, findConnection } = createService({});

    findTicket.mockResolvedValue(null);
    await service.handle({ id: "t1", type: "ticket.updated" });

    expect(findConnection).not.toHaveBeenCalled();
  });

  it("skips a ticket of a department", async () => {
    const { service, findTicket, findConnection } = createService({});

    findTicket.mockResolvedValue({ ...ticketFacts, hasDepartment: true });
    await service.handle({ id: "t1", type: "ticket.updated" });

    expect(findConnection).not.toHaveBeenCalled();
  });

  it("skips a milestone that does not exist", async () => {
    const { service, findMilestone, findConnection } = createService({});

    findMilestone.mockResolvedValue(null);
    await service.handle({ id: "m1", type: "milestone.created" });

    expect(findConnection).not.toHaveBeenCalled();
  });
});

describe("DiscordNotificationService.handle (part 2)", () => {
  it("skips a project without a connection", async () => {
    const { service, findTicket, findConnection, enqueueDelivery } =
      createService({});

    findTicket.mockResolvedValue(ticketFacts);
    findConnection.mockResolvedValue(null);
    await service.handle({ id: "t1", type: "ticket.created" });

    expect(enqueueDelivery).not.toHaveBeenCalled();
  });

  it("skips an event the project switched off", async () => {
    const { service, findTicket, findConnection, enqueueDelivery } =
      createService({});

    findTicket.mockResolvedValue(ticketFacts);
    findConnection.mockResolvedValue({
      baseUrl: "https://pages.example",
      events: { ...ALL_EVENTS, "ticket.created": false },
    });
    await service.handle({ id: "t1", type: "ticket.created" });

    expect(enqueueDelivery).not.toHaveBeenCalled();
  });

  it("logs a failure instead of throwing it", async () => {
    const error = new Error("database down");
    const { service, findTicket } = createService({});

    findTicket.mockRejectedValue(error);

    await expect(
      service.handle({ id: "t1", type: "ticket.created" }),
    ).resolves.toBeUndefined();
    expect(mocks.logCaughtError).toHaveBeenCalledWith(
      "DiscordNotificationService",
      error,
    );
    expect(mocks.logDiagnostic).toHaveBeenCalledWith(
      "DiscordNotificationService",
      "error",
      "Pages could not store a Discord notification.",
      error,
    );
  });

  it("uses the system clock when none is given", async () => {
    const { service, findTicket, enqueueDelivery } = createService({
      now: undefined,
    });

    findTicket.mockResolvedValue(ticketFacts);
    await service.handle({ id: "t1", type: "ticket.created" });

    const stored = enqueueDelivery.mock.calls[0]?.[0] as {
      readonly now: string;
    };

    expect(Number.isNaN(Date.parse(stored.now))).toBe(false);
  });
});

describe("DiscordNotificationService.listen", () => {
  it("handles every event of the source in background work", async () => {
    const { service, findTicket } = createService({});
    const unsubscribe = vi.fn();
    const listeners: ((event: PagesEvent) => void)[] = [];
    const subscribe = vi.fn((next: (event: PagesEvent) => void) => {
      listeners.push(next);

      return unsubscribe;
    });

    mocks.withBackgroundDatabaseWork.mockImplementation(
      (...args: [string, () => Promise<void>]) => args[1](),
    );
    findTicket.mockResolvedValue(null);

    const stop = service.listen({ subscribe });

    expect(stop).toBe(unsubscribe);
    listeners[0]?.({ id: "t1", type: "ticket.created" });
    await Promise.resolve();

    expect(mocks.withBackgroundDatabaseWork).toHaveBeenCalledWith(
      "discord_notification",
      expect.any(Function),
    );
    expect(findTicket).toHaveBeenCalledWith("t1");
  });
});
