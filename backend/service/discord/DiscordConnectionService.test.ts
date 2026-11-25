import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectManagementDeniedError } from "@/backend/error/ProjectErrors";
import { DEFAULT_DISCORD_EVENTS } from "@/definition/Discord";

import { DiscordConnectionService } from "./DiscordConnectionService";

import type { StoredDiscordConnection } from "@/backend/database/repositories/discord/DiscordConnectionRepository";
import type {
  DiscordAttempt,
  DiscordChannelChoice,
  DiscordDeliverySummary,
} from "@/definition/Discord";
import type { User } from "@/definition/User";
import type { DiscordConnectionServiceDependencies } from "./DiscordConnectionService";

const mocks = vi.hoisted(() => ({ resolvePublicBaseUrl: vi.fn() }));

vi.mock("@/backend/discord/DiscordConfig", () => ({
  resolvePublicBaseUrl: mocks.resolvePublicBaseUrl,
}));

const NOW = new Date("2026-06-01T08:00:00.000Z");
const INSTANCE = { isConfigured: true, missingSettings: [] };
const SUMMARY: DiscordDeliverySummary = {
  failed: 1,
  lastProblem: null,
  lastSentAt: null,
  pending: 2,
};
const ACTOR = { id: "u1" } as unknown as User;

afterEach(() => {
  vi.clearAllMocks();
});

function stored(
  overrides: Partial<StoredDiscordConnection> = {},
): StoredDiscordConnection {
  return {
    baseUrl: "https://pages.example",
    channelId: "c1",
    channelName: "general",
    connectedAt: "2026-05-01T00:00:00.000Z",
    connectedBy: "u1",
    events: DEFAULT_DISCORD_EVENTS,
    guildId: "g1",
    guildName: "Guild",
    projectId: "p1",
    updatedAt: "2026-05-02T00:00:00.000Z",
    ...overrides,
  };
}

function choice(id: string, isSelectable: boolean): DiscordChannelChoice {
  return {
    id,
    isSelectable,
    kind: "text",
    missing: isSelectable ? [] : ["SEND_MESSAGES"],
    name: `name-${id}`,
  };
}

function authorizedAttempt(): DiscordAttempt {
  return {
    authorizeUrl: null,
    expiresAt: "2026-06-01T09:00:00.000Z",
    failure: null,
    guild: { id: "g2", name: "Other" },
    id: "a1",
    status: "authorized",
  };
}

interface Setup {
  readonly service: DiscordConnectionService;
  readonly projects: {
    readonly getById: ReturnType<typeof vi.fn>;
    readonly canWriteProject: ReturnType<typeof vi.fn>;
  };
  readonly connections: Record<string, ReturnType<typeof vi.fn>>;
  readonly authorization: Record<string, ReturnType<typeof vi.fn>>;
  readonly list: ReturnType<typeof vi.fn>;
  readonly createMessage: ReturnType<typeof vi.fn>;
  readonly insertActivity: ReturnType<typeof vi.fn>;
}

function createSetup(
  overrides: Partial<DiscordConnectionServiceDependencies> = {},
): Setup {
  const projects = {
    canWriteProject: vi.fn().mockResolvedValue(true),
    getById: vi.fn().mockResolvedValue({ name: "Project" }),
  };
  const connections = {
    deleteConnection: vi.fn().mockResolvedValue(true),
    findConnection: vi.fn().mockResolvedValue(null),
    saveConnection: vi.fn().mockResolvedValue(undefined),
    updateChannel: vi.fn().mockResolvedValue(undefined),
    updateEvents: vi.fn().mockResolvedValue(undefined),
  };
  const authorization = {
    cancel: vi.fn().mockResolvedValue(undefined),
    consume: vi.fn().mockResolvedValue(undefined),
    findOwn: vi.fn().mockResolvedValue(null),
    requireConfirmable: vi.fn(),
    start: vi.fn(),
  };
  const list = vi.fn().mockResolvedValue({ ok: true, value: [] });
  const createMessage = vi.fn();
  const insertActivity = vi.fn().mockResolvedValue(undefined);

  return {
    authorization,
    connections,
    createMessage,
    insertActivity,
    list,
    projects,
    service: new DiscordConnectionService({
      activity: { insertActivity },
      authorization:
        authorization as unknown as DiscordConnectionServiceDependencies["authorization"],
      catalog: { list },
      connections,
      deliveries: { summarize: vi.fn().mockResolvedValue(SUMMARY) },
      instance: INSTANCE,
      now: () => NOW,
      projects,
      sender: { createMessage },
      ...overrides,
    }),
  };
}

describe("DiscordConnectionService.getState", () => {
  it("shows a read-only state to a reader", async () => {
    const setup = createSetup();

    setup.projects.canWriteProject.mockResolvedValue(false);
    setup.connections["findConnection"]?.mockResolvedValue(stored());

    const state = await setup.service.getState(ACTOR, "p1", {
      includeChannels: true,
    });

    expect(state).toMatchObject({
      attempt: null,
      canManage: false,
      channels: null,
      channelsProblem: null,
      instance: INSTANCE,
    });
    expect(state.connection).toMatchObject({
      channelId: "c1",
      delivery: SUMMARY,
      guildId: "g1",
      projectId: "p1",
    });
    expect(setup.authorization["findOwn"]).not.toHaveBeenCalled();
    expect(setup.list).not.toHaveBeenCalled();
  });

  it("shows an empty state without a connection", async () => {
    const setup = createSetup();

    const state = await setup.service.getState(ACTOR, "p1");

    expect(state).toMatchObject({ canManage: true, connection: null });
    expect(setup.list).not.toHaveBeenCalled();
  });

  it("lists the channels of an authorized attempt", async () => {
    const setup = createSetup();

    setup.authorization["findOwn"]?.mockResolvedValue(authorizedAttempt());
    setup.list.mockResolvedValue({ ok: true, value: [choice("c1", true)] });

    const state = await setup.service.getState(ACTOR, "p1");

    expect(setup.list).toHaveBeenCalledWith("g2");
    expect(state.channels).toEqual([choice("c1", true)]);
    expect(state.channelsProblem).toBeNull();
  });

  it("lists the channels of the connected server on request", async () => {
    const setup = createSetup();

    setup.connections["findConnection"]?.mockResolvedValue(stored());
    await setup.service.getState(ACTOR, "p1", { includeChannels: true });

    expect(setup.list).toHaveBeenCalledWith("g1");
  });

  it("does not list channels for a pending attempt or without request", async () => {
    const setup = createSetup();

    setup.connections["findConnection"]?.mockResolvedValue(stored());
    setup.authorization["findOwn"]?.mockResolvedValue({
      ...authorizedAttempt(),
      status: "pending",
    });

    await setup.service.getState(ACTOR, "p1");
    await setup.service.getState(ACTOR, "p1", { includeChannels: false });

    expect(setup.list).not.toHaveBeenCalled();
  });

  it("does not list channels without a connected server", async () => {
    const setup = createSetup();

    setup.authorization["findOwn"]?.mockResolvedValue({
      ...authorizedAttempt(),
      guild: null,
    });
    await setup.service.getState(ACTOR, "p1", { includeChannels: true });

    expect(setup.list).not.toHaveBeenCalled();
  });

  it("tells why the channels could not be listed", async () => {
    const setup = createSetup();

    setup.authorization["findOwn"]?.mockResolvedValue(authorizedAttempt());
    setup.list.mockResolvedValue({
      failure: { problem: "bot_removed", retryAfterSeconds: null, status: 404 },
      ok: false,
    });

    const state = await setup.service.getState(ACTOR, "p1");

    expect(state.channels).toBeNull();
    expect(state.channelsProblem).toBe("bot_removed");
  });

  it("lists nothing without a catalog", async () => {
    const setup = createSetup({ catalog: null });

    setup.authorization["findOwn"]?.mockResolvedValue(authorizedAttempt());

    const state = await setup.service.getState(ACTOR, "p1");

    expect(state.channels).toBeNull();
    expect(state.channelsProblem).toBeNull();
  });

  it("uses the system clock by default", async () => {
    const setup = createSetup({ now: undefined });

    setup.connections["findConnection"]?.mockResolvedValue(stored());
    setup.list.mockResolvedValue({ ok: true, value: [choice("c2", true)] });
    await setup.service.changeChannel(ACTOR, "p1", "c2");

    const stamp = setup.connections["updateChannel"]?.mock.calls[0]?.[2] as
      string | undefined;

    expect(Number.isNaN(Date.parse(stamp ?? ""))).toBe(false);
  });
});

describe("DiscordConnectionService.isConnected", () => {
  it("tells whether a connection exists", async () => {
    const setup = createSetup();

    expect(await setup.service.isConnected(ACTOR, "p1")).toBe(false);

    setup.connections["findConnection"]?.mockResolvedValue(stored());

    expect(await setup.service.isConnected(ACTOR, "p1")).toBe(true);
  });
});

describe("DiscordConnectionService management guard", () => {
  it("refuses a reader that may not write", async () => {
    const setup = createSetup();

    setup.projects.canWriteProject.mockResolvedValue(false);

    await expect(
      setup.service.cancelAttempt(ACTOR, "p1", "a1"),
    ).rejects.toBeInstanceOf(ProjectManagementDeniedError);
  });
});

describe("DiscordConnectionService.startConnection", () => {
  it("starts an attempt with the resolved public address", async () => {
    const setup = createSetup();
    const attempt = { ...authorizedAttempt(), status: "pending" as const };

    mocks.resolvePublicBaseUrl.mockReturnValue("https://public.example");
    setup.authorization["start"]?.mockResolvedValue(attempt);

    const state = await setup.service.startConnection(ACTOR, {
      projectId: "p1",
      requestOrigin: "http://internal",
    });

    expect(mocks.resolvePublicBaseUrl).toHaveBeenCalledWith("http://internal");
    expect(setup.authorization["start"]).toHaveBeenCalledWith({
      baseUrl: "https://public.example",
      projectId: "p1",
      userId: "u1",
    });
    expect(state.attempt).toBe(attempt);
  });

  it("prefers a custom address resolver", async () => {
    const resolveBaseUrl = vi.fn().mockReturnValue("https://custom.example");
    const setup = createSetup({ resolveBaseUrl });

    setup.authorization["start"]?.mockResolvedValue(authorizedAttempt());
    await setup.service.startConnection(ACTOR, {
      projectId: "p1",
      requestOrigin: "http://internal",
    });

    expect(resolveBaseUrl).toHaveBeenCalledWith("http://internal");
    expect(mocks.resolvePublicBaseUrl).not.toHaveBeenCalled();
  });

  it("refuses an instance without a Discord application", async () => {
    const setup = createSetup({
      instance: { isConfigured: false, missingSettings: ["X"] },
    });

    await expect(
      setup.service.startConnection(ACTOR, {
        projectId: "p1",
        requestOrigin: "o",
      }),
    ).rejects.toMatchObject({ code: "not_configured" });
  });
});

describe("DiscordConnectionService.confirmConnection", () => {
  const confirmation = { attemptId: "a1", channelId: "c1" };

  function prepare(setup: Setup): void {
    setup.authorization["requireConfirmable"]?.mockResolvedValue({
      baseUrl: "https://pages.example",
      guildId: "g1",
      guildName: "Guild",
      id: "a1",
    });
    setup.list.mockResolvedValue({ ok: true, value: [choice("c1", true)] });
  }

  it("saves the connection with the default events", async () => {
    const setup = createSetup();

    prepare(setup);

    await setup.service.confirmConnection(ACTOR, "p1", confirmation);

    expect(setup.authorization["consume"]).toHaveBeenCalledWith("a1");
    expect(setup.connections["saveConnection"]).toHaveBeenCalledWith({
      baseUrl: "https://pages.example",
      channelId: "c1",
      channelName: "name-c1",
      connectedBy: "u1",
      events: DEFAULT_DISCORD_EVENTS,
      guildId: "g1",
      guildName: "Guild",
      now: NOW.toISOString(),
      projectId: "p1",
    });
    expect(setup.insertActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "discord_connected",
        category: "integrations",
        projectId: "p1",
        userId: "u1",
      }),
    );
  });

  it("keeps the events of an existing connection", async () => {
    const setup = createSetup();
    const events = { ...DEFAULT_DISCORD_EVENTS, "ticket.created": false };

    prepare(setup);
    setup.connections["findConnection"]?.mockResolvedValue(stored({ events }));

    await setup.service.confirmConnection(ACTOR, "p1", confirmation);

    expect(setup.connections["saveConnection"]).toHaveBeenCalledWith(
      expect.objectContaining({ events }),
    );
  });

  it("refuses a channel the bot cannot use", async () => {
    const setup = createSetup();

    prepare(setup);
    setup.list.mockResolvedValue({ ok: true, value: [choice("c1", false)] });

    await expect(
      setup.service.confirmConnection(ACTOR, "p1", confirmation),
    ).rejects.toMatchObject({ code: "channel_unavailable" });
    expect(setup.authorization["consume"]).not.toHaveBeenCalled();
  });

  it("refuses an unknown channel", async () => {
    const setup = createSetup();

    prepare(setup);

    await expect(
      setup.service.confirmConnection(ACTOR, "p1", {
        attemptId: "a1",
        channelId: "missing",
      }),
    ).rejects.toMatchObject({ code: "channel_unavailable" });
  });

  it("reports an unreachable Discord", async () => {
    const setup = createSetup();

    prepare(setup);
    setup.list.mockResolvedValue({
      failure: { problem: "unavailable", retryAfterSeconds: null, status: 503 },
      ok: false,
    });

    await expect(
      setup.service.confirmConnection(ACTOR, "p1", confirmation),
    ).rejects.toMatchObject({ code: "discord_unavailable" });
  });

  it("reports a missing catalog", async () => {
    const setup = createSetup({ catalog: null });

    prepare(setup);

    await expect(
      setup.service.confirmConnection(ACTOR, "p1", confirmation),
    ).rejects.toMatchObject({ code: "not_configured" });
  });
});

describe("DiscordConnectionService.changeChannel", () => {
  it("points the connection at another channel", async () => {
    const setup = createSetup();

    setup.connections["findConnection"]?.mockResolvedValue(stored());
    setup.list.mockResolvedValue({ ok: true, value: [choice("c2", true)] });

    await setup.service.changeChannel(ACTOR, "p1", "c2");

    expect(setup.list).toHaveBeenCalledWith("g1");
    expect(setup.connections["updateChannel"]).toHaveBeenCalledWith(
      "p1",
      choice("c2", true),
      NOW.toISOString(),
    );
    expect(setup.insertActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "discord_channel_changed" }),
    );
  });

  it("refuses a project without a connection", async () => {
    const setup = createSetup();

    await expect(
      setup.service.changeChannel(ACTOR, "p1", "c2"),
    ).rejects.toMatchObject({ code: "not_connected" });
  });
});

describe("DiscordConnectionService.setEvents", () => {
  it("stores a complete selection", async () => {
    const setup = createSetup();
    const events = { ...DEFAULT_DISCORD_EVENTS, "milestone.updated": false };

    setup.connections["findConnection"]?.mockResolvedValue(stored());
    await setup.service.setEvents(ACTOR, "p1", events);

    expect(setup.connections["updateEvents"]).toHaveBeenCalledWith(
      "p1",
      events,
      NOW.toISOString(),
    );
    expect(setup.insertActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "discord_events_changed" }),
    );
  });

  it("refuses a project without a connection", async () => {
    const setup = createSetup();

    await expect(
      setup.service.setEvents(ACTOR, "p1", DEFAULT_DISCORD_EVENTS),
    ).rejects.toMatchObject({ code: "not_connected" });
  });

  it("refuses an incomplete selection", async () => {
    const setup = createSetup();
    const events = JSON.parse(
      '{"ticket.created":true,"ticket.updated":true,"milestone.created":true,"milestone.updated":"yes"}',
    ) as typeof DEFAULT_DISCORD_EVENTS;

    setup.connections["findConnection"]?.mockResolvedValue(stored());

    await expect(
      setup.service.setEvents(ACTOR, "p1", events),
    ).rejects.toMatchObject({ code: "invalid_events" });
    expect(setup.connections["updateEvents"]).not.toHaveBeenCalled();
  });
});

describe("DiscordConnectionService.sendTest", () => {
  it("reports a delivered test message", async () => {
    const setup = createSetup();

    setup.connections["findConnection"]?.mockResolvedValue(stored());
    setup.createMessage.mockResolvedValue({ ok: true, value: null });

    expect(await setup.service.sendTest(ACTOR, "p 1")).toEqual({
      isSent: true,
      problem: null,
    });

    const [channelId, body, nonce] = setup.createMessage.mock.calls[0] as [
      string,
      { readonly content: string },
      string,
    ];

    expect(channelId).toBe("c1");
    expect(body.content).toContain("https://pages.example/projekte/p%201");
    expect(nonce).toHaveLength(24);
  });

  it("reports the problem of a refused test message", async () => {
    const setup = createSetup();

    setup.connections["findConnection"]?.mockResolvedValue(stored());
    setup.createMessage.mockResolvedValue({
      failure: {
        problem: "missing_permissions",
        retryAfterSeconds: null,
        status: 403,
      },
      ok: false,
    });

    expect(await setup.service.sendTest(ACTOR, "p1")).toEqual({
      isSent: false,
      problem: "missing_permissions",
    });
  });

  it("refuses a project without a connection", async () => {
    const setup = createSetup();

    await expect(setup.service.sendTest(ACTOR, "p1")).rejects.toMatchObject({
      code: "not_connected",
    });
  });

  it("refuses without a sender", async () => {
    const setup = createSetup({ sender: null });

    setup.connections["findConnection"]?.mockResolvedValue(stored());

    await expect(setup.service.sendTest(ACTOR, "p1")).rejects.toMatchObject({
      code: "not_configured",
    });
  });
});

describe("DiscordConnectionService.disconnect", () => {
  it("removes the connection and records it", async () => {
    const setup = createSetup();

    await setup.service.disconnect(ACTOR, "p1");

    expect(setup.connections["deleteConnection"]).toHaveBeenCalledWith("p1");
    expect(setup.insertActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "discord_disconnected" }),
    );
  });

  it("records nothing when there was no connection", async () => {
    const setup = createSetup();

    setup.connections["deleteConnection"]?.mockResolvedValue(false);
    await setup.service.disconnect(ACTOR, "p1");

    expect(setup.insertActivity).not.toHaveBeenCalled();
  });
});

describe("DiscordConnectionService.cancelAttempt", () => {
  it("ends the attempt of the actor", async () => {
    const setup = createSetup();

    await setup.service.cancelAttempt(ACTOR, "p1", "a1");

    expect(setup.authorization["cancel"]).toHaveBeenCalledWith({
      attemptId: "a1",
      projectId: "p1",
      userId: "u1",
    });
  });
});
