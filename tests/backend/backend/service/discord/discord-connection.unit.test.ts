import { expect, it } from "vitest";

import {
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import { DiscordAuthorizationService } from "@/backend/service/discord/DiscordAuthorizationService";
import { DiscordConnectionService } from "@/backend/service/discord/DiscordConnectionService";
import { DEFAULT_DISCORD_EVENTS } from "@/definition/Discord";

import { MemoryAttemptStore } from "./discord-memory-stores";
import { BASE_URL, DiscordWorld, ticketFacts } from "./discord-world";
import { APPLICATION, textChannel } from "./fake-discord";

import type { DiscordEventSelection } from "@/definition/Discord";

const BOT_ROLE = "bot-role";

async function authorizeServer(world: DiscordWorld): Promise<string> {
  const { callback } = await world.startAndAuthorize("300");

  await world.authorization.complete(callback);

  const attempt = await world.attempts.findLatestAttempt("alpha", "owner");

  return attempt?.id ?? "";
}

function worldWithChannels(): DiscordWorld {
  const world = new DiscordWorld();

  world.discord.addGuild({
    channels: [
      textChannel("201", "general"),
      textChannel("202", "announcements", { type: 5 }),
      textChannel("203", "read-only", {
        botMaySend: false,
        overwrites: [{ allow: "0", deny: "2048", id: BOT_ROLE, type: 0 }],
      }),
      textChannel("204", "hidden", {
        botMaySend: false,
        overwrites: [{ allow: "0", deny: "1024", id: "300", type: 0 }],
      }),
      textChannel("205", "voice", { type: 2 }),
      textChannel("206", "category", { type: 4 }),
    ],
    id: "300",
    name: "Team server",
    roles: [
      { id: "300", permissions: "0" },
      { id: BOT_ROLE, permissions: "3072" },
    ],
  });

  return world;
}

it("shows everyone who can read the project the connection, but only managers the controls", async () => {
  const world = new DiscordWorld();

  await world.connectAlpha();

  const asReader = await world.service.getState(world.reader, "alpha");
  const asOwner = await world.service.getState(world.owner, "alpha");

  expect(asReader).toMatchObject({
    attempt: null,
    canManage: false,
    channels: null,
    connection: { channelName: "general", guildName: "Team server" },
  });
  expect(asOwner.canManage).toBe(true);
});

it("refuses every change to a reader and a stranger", async () => {
  const world = new DiscordWorld();

  await world.connectAlpha();

  const attemptId = "any";
  const refusals = [
    world.service.startConnection(world.reader, {
      projectId: "alpha",
      requestOrigin: BASE_URL,
    }),
    world.service.confirmConnection(world.reader, "alpha", {
      attemptId,
      channelId: "201",
    }),
    world.service.changeChannel(world.reader, "alpha", "201"),
    world.service.setEvents(world.reader, "alpha", DEFAULT_DISCORD_EVENTS),
    world.service.sendTest(world.reader, "alpha"),
    world.service.disconnect(world.reader, "alpha"),
    world.service.cancelAttempt(world.reader, "alpha", attemptId),
  ];

  for (const refusal of refusals) {
    await expect(refusal).rejects.toBeInstanceOf(ProjectManagementDeniedError);
  }

  await expect(
    world.service.getState(world.stranger, "alpha"),
  ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  await expect(
    world.service.disconnect(world.stranger, "alpha"),
  ).rejects.toBeInstanceOf(ProjectAccessDeniedError);
  await expect(
    world.service.getState(world.owner, "missing"),
  ).rejects.toBeInstanceOf(ProjectNotFoundError);
  expect(world.connections.rows.get("alpha")?.events).toEqual(
    DEFAULT_DISCORD_EVENTS,
  );
});

it("lists only text and announcement channels and shows the missing permissions", async () => {
  const world = worldWithChannels();

  await authorizeServer(world);

  const state = await world.service.getState(world.owner, "alpha");

  expect(state.channels).toEqual([
    {
      id: "201",
      isSelectable: true,
      kind: "text",
      missing: [],
      name: "general",
    },
    {
      id: "202",
      isSelectable: true,
      kind: "announcement",
      missing: [],
      name: "announcements",
    },
    {
      id: "203",
      isSelectable: false,
      kind: "text",
      missing: ["SEND_MESSAGES"],
      name: "read-only",
    },
    {
      id: "204",
      isSelectable: false,
      kind: "text",
      missing: ["VIEW_CHANNEL", "SEND_MESSAGES"],
      name: "hidden",
    },
  ]);
});

it("refuses a channel in which the bot cannot post and keeps the attempt usable", async () => {
  const world = worldWithChannels();
  const attemptId = await authorizeServer(world);

  for (const channelId of ["203", "204", "205", "999"]) {
    await expect(
      world.service.confirmConnection(world.owner, "alpha", {
        attemptId,
        channelId,
      }),
    ).rejects.toMatchObject({ code: "channel_unavailable" });
  }

  expect(world.connections.rows.size).toBe(0);

  const state = await world.service.confirmConnection(world.owner, "alpha", {
    attemptId,
    channelId: "202",
  });

  expect(state.connection?.channelName).toBe("announcements");
});

it("saves the connection only after the confirmation, with every event switched on", async () => {
  const world = worldWithChannels();
  const attemptId = await authorizeServer(world);

  expect(world.connections.rows.size).toBe(0);

  const state = await world.service.confirmConnection(world.owner, "alpha", {
    attemptId,
    channelId: "201",
  });

  expect(state.connection).toMatchObject({
    channelId: "201",
    events: DEFAULT_DISCORD_EVENTS,
    guildId: "300",
    guildName: "Team server",
    projectId: "alpha",
  });
  expect(world.connections.rows.get("alpha")).toMatchObject({
    baseUrl: BASE_URL,
    connectedBy: "owner",
  });
  expect(world.activity.map((entry) => entry.action)).toEqual([
    "discord_connected",
  ]);
  expect(state.attempt).toBeNull();
});

it("keeps the event selection when the project connects to another server", async () => {
  const world = worldWithChannels();

  await world.connectAlpha();
  await world.service.setEvents(world.owner, "alpha", {
    ...DEFAULT_DISCORD_EVENTS,
    "ticket.updated": false,
  });
  world.discord.addGuild({ id: "400", name: "Second server" });

  const { callback } = await world.startAndAuthorize("400");

  await world.authorization.complete(callback);

  const attempt = await world.attempts.findLatestAttempt("alpha", "owner");
  const state = await world.service.confirmConnection(world.owner, "alpha", {
    attemptId: attempt?.id ?? "",
    channelId: "201",
  });

  expect(state.connection).toMatchObject({
    events: { ...DEFAULT_DISCORD_EVENTS, "ticket.updated": false },
    guildId: "400",
  });
});

it("switches the four events independently of each other", async () => {
  const world = new DiscordWorld();

  await world.connectAlpha();

  for (const type of Object.keys(DEFAULT_DISCORD_EVENTS)) {
    const selection: DiscordEventSelection = {
      "milestone.created": false,
      "milestone.updated": false,
      "ticket.created": false,
      "ticket.updated": false,
      [type]: true,
    };
    const state = await world.service.setEvents(
      world.owner,
      "alpha",
      selection,
    );

    expect(state.connection?.events).toEqual(selection);
  }
});

it("rejects an event selection that does not name every event with a boolean", async () => {
  const world = new DiscordWorld();

  await world.connectAlpha();

  const incomplete = JSON.parse(
    '{"ticket.created":true}',
  ) as DiscordEventSelection;

  await expect(
    world.service.setEvents(world.owner, "alpha", incomplete),
  ).rejects.toMatchObject({ code: "invalid_events" });
  expect(world.connections.rows.get("alpha")?.events).toEqual(
    DEFAULT_DISCORD_EVENTS,
  );
});

it("needs a connection for the events, the channel and the test", async () => {
  const world = new DiscordWorld();

  await expect(
    world.service.setEvents(world.owner, "alpha", DEFAULT_DISCORD_EVENTS),
  ).rejects.toMatchObject({ code: "not_connected" });
  await expect(
    world.service.changeChannel(world.owner, "alpha", "201"),
  ).rejects.toMatchObject({ code: "not_connected" });
  await expect(
    world.service.sendTest(world.owner, "alpha"),
  ).rejects.toMatchObject({ code: "not_connected" });
});

it("changes the channel only to one the bot can post in", async () => {
  const world = worldWithChannels();

  await world.connectAlpha();

  await expect(
    world.service.changeChannel(world.owner, "alpha", "203"),
  ).rejects.toMatchObject({ code: "channel_unavailable" });

  const state = await world.service.changeChannel(world.owner, "alpha", "202");

  expect(state.connection).toMatchObject({
    channelId: "202",
    channelName: "announcements",
  });
});

it("lists the channels of the connected server on request", async () => {
  const world = worldWithChannels();

  await world.connectAlpha();

  const without = await world.service.getState(world.owner, "alpha");
  const withChannels = await world.service.getState(world.owner, "alpha", {
    includeChannels: true,
  });

  expect(without.channels).toBeNull();
  expect(withChannels.channels?.map((channel) => channel.id)).toEqual([
    "201",
    "202",
    "203",
    "204",
  ]);
});

it("reports when Discord rejects the credentials of the application", async () => {
  const world = worldWithChannels();

  await authorizeServer(world);
  world.discord.scripted.push({ body: {}, status: 401 });

  const state = await world.service.getState(world.owner, "alpha");

  expect(state.channels).toBeNull();
  expect(state.channelsProblem).toBe("invalid_credentials");
});

it("sends a test message with mentions disabled", async () => {
  const world = new DiscordWorld();

  await world.connectAlpha();

  await expect(world.service.sendTest(world.owner, "alpha")).resolves.toEqual({
    isSent: true,
    problem: null,
  });
  expect(world.discord.messages).toHaveLength(1);
  expect(world.discord.messages[0]).toMatchObject({
    allowedMentions: { parse: [] },
    channelId: "201",
  });
  expect(world.discord.messages[0]?.content).toContain("Pages test message");
  expect(world.discord.messages[0]?.content).toContain(
    `${BASE_URL}/projekte/alpha`,
  );
});

it("tells why the test message was not sent", async () => {
  const world = new DiscordWorld();

  await world.connectAlpha();
  world.discord.guilds.set("300", {
    ...(world.discord.guilds.get("300") ??
      world.discord.addGuild({ id: "300" })),
    channels: [textChannel("201", "general", { botMaySend: false })],
  });

  await expect(world.service.sendTest(world.owner, "alpha")).resolves.toEqual({
    isSent: false,
    problem: "missing_permissions",
  });

  world.discord.isDown = true;

  await expect(world.service.sendTest(world.owner, "alpha")).resolves.toEqual({
    isSent: false,
    problem: "unavailable",
  });
});

it("disconnects one project and leaves the bot on the server and the other projects connected", async () => {
  const world = new DiscordWorld();

  await world.connectAlpha();
  await world.connections.saveConnection({
    baseUrl: BASE_URL,
    channelId: "201",
    channelName: "general",
    connectedBy: "owner",
    events: DEFAULT_DISCORD_EVENTS,
    guildId: "300",
    guildName: "Team server",
    now: world.now(),
    projectId: "beta",
  });
  world.tickets.set("t1", {
    departmentId: null,
    key: "PAGE-1",
    projectId: "alpha",
    projectName: "Alpha",
    statusName: "To Do",
    title: "Waiting",
  });
  await world.notifications.handle({ id: "t1", type: "ticket.created" });
  expect(world.deliveries.rows.size).toBe(1);

  const requestsBefore = world.discord.requests.length;
  const state = await world.service.disconnect(world.owner, "alpha");

  expect(state.connection).toBeNull();
  expect(world.connections.rows.has("alpha")).toBe(false);
  expect(world.connections.rows.has("beta")).toBe(true);
  // The settings and the messages that were not sent are gone ...
  expect(world.deliveries.rows.size).toBe(0);
  // ... and nothing was sent to Discord, in particular nothing that removes the bot.
  expect(
    world.discord.requests.slice(requestsBefore).map((r) => r.method),
  ).toEqual(
    world.discord.requests
      .slice(requestsBefore)
      .filter((request) => request.method === "GET")
      .map((request) => request.method),
  );
  expect(
    world.discord.requests
      .slice(requestsBefore)
      .some((request) => request.method === "DELETE"),
  ).toBe(false);
  expect(world.activity.map((entry) => entry.action)).toContain(
    "discord_disconnected",
  );

  // Disconnecting twice is harmless and records nothing more.
  const activityCount = world.activity.length;

  await world.service.disconnect(world.owner, "alpha");
  expect(world.activity).toHaveLength(activityCount);
});

it("explains a missing Discord application and never takes credentials", async () => {
  const world = new DiscordWorld();
  const service = new DiscordConnectionService({
    activity: { insertActivity: async () => undefined },
    authorization: new DiscordAuthorizationService({
      attempts: new MemoryAttemptStore(),
      runtime: null,
    }),
    catalog: null,
    connections: world.connections,
    deliveries: world.deliveries,
    instance: {
      isConfigured: false,
      missingSettings: [
        "PAGES_DISCORD_APPLICATION_ID",
        "PAGES_DISCORD_CLIENT_SECRET",
        "PAGES_DISCORD_BOT_TOKEN",
      ],
    },
    projects: {
      canWriteProject: async () => true,
      getById: async () => ({ name: "Alpha" }),
    },
    sender: null,
  });

  const state = await service.getState(world.owner, "alpha");

  expect(state.instance).toEqual({
    isConfigured: false,
    missingSettings: [
      "PAGES_DISCORD_APPLICATION_ID",
      "PAGES_DISCORD_CLIENT_SECRET",
      "PAGES_DISCORD_BOT_TOKEN",
    ],
  });
  await expect(
    service.startConnection(world.owner, {
      projectId: "alpha",
      requestOrigin: BASE_URL,
    }),
  ).rejects.toMatchObject({ code: "not_configured" });
});

it("never lets a Discord credential reach a client or a request address", async () => {
  const world = worldWithChannels();
  const attemptId = await authorizeServer(world);
  const states = [
    await world.service.getState(world.owner, "alpha"),
    await world.service.confirmConnection(world.owner, "alpha", {
      attemptId,
      channelId: "201",
    }),
    await world.service.getState(world.reader, "alpha"),
  ];
  const secrets = [APPLICATION.botToken, APPLICATION.clientSecret];

  for (const secret of secrets) {
    expect(JSON.stringify(states)).not.toContain(secret);
    expect(
      world.discord.requests.map((request) => request.url).join(" "),
    ).not.toContain(secret);
    expect(
      world.discord.requests.map((request) => request.body).join(" "),
    ).not.toContain(secret);
  }
});

it("reports whether a project is connected for its card", async () => {
  const world = new DiscordWorld();

  await expect(world.service.isConnected(world.reader, "alpha")).resolves.toBe(
    false,
  );
  await world.connectAlpha();
  await expect(world.service.isConnected(world.reader, "alpha")).resolves.toBe(
    true,
  );
  await expect(world.service.isConnected(world.owner, "beta")).resolves.toBe(
    false,
  );
});

it("starts a new connection without the counters and problems of the old one", async () => {
  const world = new DiscordWorld();

  await world.connectAlpha();
  world.tickets.set("t1", ticketFacts());
  world.discord.isDown = true;
  await world.notifications.handle({ id: "t1", type: "ticket.created" });
  await world.worker.runDue();
  expect(
    (await world.service.getState(world.owner, "alpha")).connection?.delivery
      .lastProblem,
  ).toBe("unavailable");

  await world.service.disconnect(world.owner, "alpha");
  expect(world.deliveries.rows.size).toBe(0);

  world.discord.isDown = false;
  const state = await world.connectAlpha();

  expect(state.connection?.delivery).toEqual({
    failed: 0,
    lastProblem: null,
    lastSentAt: null,
    pending: 0,
  });
});
