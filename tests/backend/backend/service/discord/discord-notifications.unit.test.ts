import { expect, it, vi } from "vitest";

import { DEFAULT_DISCORD_EVENTS } from "@/definition/Discord";

import { BASE_URL, DiscordWorld, ticketFacts } from "./discord-world";
import { textChannel } from "./fake-discord";

import type { DiscordEventSelection } from "@/definition/Discord";

function onlyEvent(type: keyof DiscordEventSelection): DiscordEventSelection {
  return {
    "milestone.created": false,
    "milestone.updated": false,
    "ticket.created": false,
    "ticket.updated": false,
    [type]: true,
  };
}

async function connectedWorld(): Promise<DiscordWorld> {
  const world = new DiscordWorld();

  await world.connectAlpha();
  world.tickets.set("t1", ticketFacts());
  world.milestones.set("m1", {
    name: "Release 1.0",
    projectId: "alpha",
    projectName: "Alpha",
    status: "open",
  });

  return world;
}

function storedContents(world: DiscordWorld): Record<string, unknown>[] {
  return [...world.deliveries.rows.values()].map((row) => {
    const parsed: unknown = JSON.parse(row.contentJson);

    return typeof parsed === "object" && parsed !== null
      ? Object.fromEntries(Object.entries(parsed))
      : {};
  });
}

it("stores a short message with the Pages link for an enabled event", async () => {
  const world = await connectedWorld();

  await world.notifications.handle({ id: "t1", type: "ticket.created" });

  expect(storedContents(world)).toEqual([
    {
      event: "ticket.created",
      projectName: "Alpha",
      reference: "PAGE-7",
      status: "In Arbeit",
      title: "Write the notification",
      url: `${BASE_URL}/tasks/PAGE-7`,
    },
  ]);
  expect(world.enqueued).toBe(1);
});

it("describes a milestone with its planning link", async () => {
  const world = await connectedWorld();

  await world.notifications.handle({ id: "m1", type: "milestone.updated" });

  expect(storedContents(world)).toEqual([
    {
      event: "milestone.updated",
      projectName: "Alpha",
      reference: null,
      status: "open",
      title: "Release 1.0",
      url: `${BASE_URL}/projekte/alpha?tab=planning`,
    },
  ]);
});

it("announces only the events the project switched on, each on its own", async () => {
  const world = await connectedWorld();
  const events = [
    { id: "t1", type: "ticket.created" },
    { id: "t1", type: "ticket.updated" },
    { id: "m1", type: "milestone.created" },
    { id: "m1", type: "milestone.updated" },
  ] as const;

  for (const enabled of Object.keys(DEFAULT_DISCORD_EVENTS)) {
    await world.service.setEvents(
      world.owner,
      "alpha",
      onlyEvent(enabled as keyof DiscordEventSelection),
    );
    world.deliveries.rows.clear();

    for (const event of events) {
      await world.notifications.handle(event);
    }

    expect(
      [...world.deliveries.rows.values()].map((row) => row.eventType),
    ).toEqual([enabled]);
  }
});

it("sends nothing for a project without a connection and nothing to another project's channel", async () => {
  const world = await connectedWorld();

  world.tickets.set(
    "t-beta",
    ticketFacts({ key: "BETA-1", projectId: "beta" }),
  );
  await world.notifications.handle({ id: "t-beta", type: "ticket.created" });
  expect(world.deliveries.rows.size).toBe(0);

  await world.notifications.handle({ id: "t1", type: "ticket.created" });
  await world.worker.runDue();

  expect(world.discord.messages).toHaveLength(1);
  expect(world.discord.messages[0]?.content).toContain("PAGE-7");
  expect(world.discord.messages[0]?.channelId).toBe("201");
});

it("does not announce tickets of a department, unknown tickets or other kinds of events", async () => {
  const world = await connectedWorld();

  world.tickets.set("t-private", ticketFacts({ departmentId: "engineering" }));

  await world.notifications.handle({ id: "t-private", type: "ticket.created" });
  await world.notifications.handle({ id: "missing", type: "ticket.updated" });
  await world.notifications.handle({ id: "w1", type: "wiki.page.updated" });
  await world.notifications.handle({ id: "w1", type: "asset.linked" });

  expect(world.deliveries.rows.size).toBe(0);
});

it("reacts to the events of the shared publisher, from the interface and from agents alike", async () => {
  const world = await connectedWorld();

  world.notifications.listen(world.publisher);
  world.publisher.publish({ id: "t1", type: "ticket.updated" });
  world.publisher.publish({ id: "m1", type: "milestone.created" });

  await vi.waitFor(() => {
    expect(world.deliveries.rows.size).toBe(2);
  });
});

it("never lets a failure while storing a notification reach the Pages change", async () => {
  const world = await connectedWorld();
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

  vi.spyOn(world.deliveries, "enqueueDelivery").mockRejectedValue(
    new Error("disk full"),
  );

  await expect(
    world.notifications.handle({ id: "t1", type: "ticket.created" }),
  ).resolves.toBeUndefined();
  expect(error).toHaveBeenCalled();
});

it("delivers a stored message with mentions disabled and without link previews", async () => {
  const world = await connectedWorld();

  await world.notifications.handle({ id: "t1", type: "ticket.created" });

  await expect(world.worker.runDue()).resolves.toMatchObject({ sent: 1 });
  expect(world.discord.messages).toHaveLength(1);
  expect(world.discord.messages[0]).toMatchObject({
    allowedMentions: { parse: [] },
    channelId: "201",
    flags: 4,
  });
  expect(world.discord.messages[0]?.content.split("\n")).toEqual([
    "**Ticket created** · PAGE-7",
    "\u200BWrite the notification",
    "Project: Alpha · Status: In Arbeit",
    `${BASE_URL}/tasks/PAGE-7`,
  ]);
  expect([...world.deliveries.rows.values()][0]?.status).toBe("sent");
});

it("cannot be made to ping anyone by a ticket or milestone title", async () => {
  const world = await connectedWorld();
  const hostile =
    "@everyone @here <@123456789012345678> <@&987654321098765432> <#555> [free nitro](https://evil.example/login) https://evil.example **bold**";

  world.tickets.set("t1", ticketFacts({ title: hostile }));
  world.milestones.set("m1", {
    name: hostile,
    projectId: "alpha",
    projectName: `Project ${hostile}`,
    status: "open",
  });

  await world.notifications.handle({ id: "t1", type: "ticket.created" });
  await world.notifications.handle({ id: "m1", type: "milestone.created" });
  await world.worker.runDue();

  expect(world.discord.messages).toHaveLength(2);

  for (const message of world.discord.messages) {
    expect(message.allowedMentions).toEqual({ parse: [] });
    expect(message.content).not.toMatch(/@everyone|@here/);
    expect(message.content).not.toMatch(/<@[!&]?\d+>/);
    expect(message.content).not.toContain("<#555>");
    expect(message.content).not.toContain("](https://");
    expect(message.content).not.toContain("https://evil.example");
  }
});

it("keeps the Pages change independent of a Discord outage and retries later", async () => {
  const world = await connectedWorld();

  world.discord.isDown = true;
  await world.notifications.handle({ id: "t1", type: "ticket.created" });

  await expect(world.worker.runDue()).resolves.toMatchObject({
    retried: 1,
    sent: 0,
  });

  const row = [...world.deliveries.rows.values()][0];

  expect(row).toMatchObject({
    attempts: 1,
    lastProblem: "unavailable",
    status: "pending",
  });
  // The message is stored, so it survives and the first retry waits 30 seconds.
  expect(row?.nextAttemptAt).toBe(
    new Date(Date.parse(world.now()) + 30_000).toISOString(),
  );

  world.discord.isDown = false;
  await expect(world.worker.runDue()).resolves.toMatchObject({ sent: 0 });

  world.advance(30_000);
  await expect(world.worker.runDue()).resolves.toMatchObject({ sent: 1 });
  expect(world.discord.messages).toHaveLength(1);
});

it("gives a message up after a bounded number of attempts and shows the problem", async () => {
  const world = await connectedWorld();

  world.discord.isDown = true;
  await world.notifications.handle({ id: "t1", type: "ticket.created" });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await world.worker.runDue();
    world.advance(3 * 60 * 60 * 1000);
  }

  const row = [...world.deliveries.rows.values()][0];

  expect(row).toMatchObject({
    attempts: 6,
    lastProblem: "unavailable",
    status: "failed",
  });

  await world.worker.runDue();
  expect(
    world.discord.requests.filter((r) => r.url.endsWith("/messages")),
  ).toHaveLength(6);

  const state = await world.service.getState(world.owner, "alpha");

  expect(state.connection?.delivery).toMatchObject({
    failed: 1,
    lastProblem: "unavailable",
    pending: 0,
  });
});

it("waits for the time Discord names in Retry-After and holds back the queue", async () => {
  const world = await connectedWorld();

  world.tickets.set("t2", ticketFacts({ key: "PAGE-8", title: "Second" }));
  await world.notifications.handle({ id: "t1", type: "ticket.created" });
  world.advance(10);
  await world.notifications.handle({ id: "t2", type: "ticket.created" });
  world.discord.scripted.push({
    body: { message: "You are being rate limited.", retry_after: 0.5 },
    headers: { "retry-after": "2" },
    status: 429,
  });

  await expect(world.worker.runDue()).resolves.toMatchObject({
    retried: 1,
    sent: 0,
  });

  // The rate limit is no failure: the attempt counter stays, nothing else was tried.
  expect(
    [...world.deliveries.rows.values()].map((row) => row.attempts),
  ).toEqual([0, 0]);
  expect(
    world.discord.requests.filter((r) => r.url.endsWith("/messages")),
  ).toHaveLength(1);

  world.advance(1_000);
  await expect(world.worker.runDue()).resolves.toMatchObject({ sent: 0 });

  world.advance(1_100);
  await expect(world.worker.runDue()).resolves.toMatchObject({ sent: 2 });
  expect(world.discord.messages.map((m) => m.content.split("\n")[1])).toEqual([
    "\u200BWrite the notification",
    "\u200BSecond",
  ]);
});

it("falls back to retry_after of the body when the header is missing", async () => {
  const world = await connectedWorld();

  await world.notifications.handle({ id: "t1", type: "ticket.created" });
  world.discord.scripted.push({ body: { retry_after: 3.2 }, status: 429 });
  await world.worker.runDue();

  const row = [...world.deliveries.rows.values()][0];

  expect(row?.nextAttemptAt).toBe(
    new Date(Date.parse(world.now()) + 3_200).toISOString(),
  );
  expect(row?.lastProblem).toBe("rate_limited");
});

it("posts a retried message only once, even when the answer of Discord was lost", async () => {
  const world = await connectedWorld();

  await world.notifications.handle({ id: "t1", type: "ticket.created" });
  world.discord.loseNextMessageResponse = true;

  await expect(world.worker.runDue()).resolves.toMatchObject({ retried: 1 });
  expect(world.discord.messages).toHaveLength(1);

  world.advance(30_000);
  await expect(world.worker.runDue()).resolves.toMatchObject({ sent: 1 });

  // The retry carried the same nonce, so Discord created no second message.
  expect(world.discord.messages).toHaveLength(1);
  expect([...world.deliveries.rows.values()][0]?.status).toBe("sent");
});

it("gives up at once on a problem a retry cannot fix", async () => {
  const world = await connectedWorld();

  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  world.discord.guilds.set("300", {
    ...(world.discord.guilds.get("300") ??
      world.discord.addGuild({ id: "300" })),
    channels: [],
  });
  await world.notifications.handle({ id: "t1", type: "ticket.created" });

  await expect(world.worker.runDue()).resolves.toMatchObject({ failed: 1 });
  expect([...world.deliveries.rows.values()][0]).toMatchObject({
    attempts: 1,
    lastProblem: "channel_missing",
    status: "failed",
  });
});

it("retries a missing permission, because an administrator may fix it meanwhile", async () => {
  const world = await connectedWorld();

  world.discord.guilds.set("300", {
    ...(world.discord.guilds.get("300") ??
      world.discord.addGuild({ id: "300" })),
    channels: [textChannel("201", "general", { botMaySend: false })],
  });
  await world.notifications.handle({ id: "t1", type: "ticket.created" });

  await expect(world.worker.runDue()).resolves.toMatchObject({ retried: 1 });
  expect([...world.deliveries.rows.values()][0]).toMatchObject({
    lastProblem: "missing_permissions",
    status: "pending",
  });

  const state = await world.service.getState(world.owner, "alpha");

  expect(state.connection?.delivery.lastProblem).toBe("missing_permissions");
});

it("drops a message whose event was switched off after it was stored", async () => {
  const world = await connectedWorld();

  await world.notifications.handle({ id: "t1", type: "ticket.created" });
  await world.service.setEvents(
    world.owner,
    "alpha",
    onlyEvent("milestone.created"),
  );

  await expect(world.worker.runDue()).resolves.toMatchObject({
    sent: 0,
    skipped: 1,
  });
  expect(world.discord.messages).toHaveLength(0);
  expect(world.deliveries.rows.size).toBe(0);
});

it("does not send a message that waited longer than a day", async () => {
  const world = await connectedWorld();

  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  world.discord.isDown = true;
  await world.notifications.handle({ id: "t1", type: "ticket.created" });
  await world.worker.runDue();
  world.discord.isDown = false;
  world.advance(25 * 60 * 60 * 1000);

  await expect(world.worker.runDue()).resolves.toMatchObject({
    failed: 1,
    sent: 0,
  });
  expect(world.discord.messages).toHaveLength(0);
});

it("takes a message back that a crashed run had locked", async () => {
  const world = await connectedWorld();

  await world.notifications.handle({ id: "t1", type: "ticket.created" });
  // A run claimed the message and the process died before it finished.
  await world.deliveries.claimDue(world.now(), "2026-10-15T10:02:00.000Z", 10);

  await expect(world.worker.runDue()).resolves.toMatchObject({ sent: 0 });

  world.advance(3 * 60 * 1000);
  await expect(world.worker.runDue()).resolves.toMatchObject({ sent: 1 });
});

it("ignores a second run that overlaps the first", async () => {
  const world = await connectedWorld();

  await world.notifications.handle({ id: "t1", type: "ticket.created" });

  const [first, second] = await Promise.all([
    world.worker.runDue(),
    world.worker.runDue(),
  ]);

  expect(first.sent + second.sent).toBe(1);
  expect(world.discord.messages).toHaveLength(1);
});

it("removes old finished deliveries and expired attempts", async () => {
  const world = await connectedWorld();

  await world.notifications.handle({ id: "t1", type: "ticket.created" });
  await world.worker.runDue();
  expect(world.deliveries.rows.size).toBe(1);

  world.advance(8 * 24 * 60 * 60 * 1000);
  await world.worker.runDue();

  expect(world.deliveries.rows.size).toBe(0);
  expect(world.attempts.rows.size).toBe(0);
});

it("clears the shown problem once a later message arrived", async () => {
  const world = await connectedWorld();

  world.discord.isDown = true;
  await world.notifications.handle({ id: "t1", type: "ticket.created" });
  await world.worker.runDue();
  expect(
    (await world.service.getState(world.owner, "alpha")).connection?.delivery
      .lastProblem,
  ).toBe("unavailable");

  world.discord.isDown = false;
  world.advance(30_000);
  await world.worker.runDue();

  const delivery = (await world.service.getState(world.owner, "alpha"))
    .connection?.delivery;

  expect(delivery).toMatchObject({ failed: 0, lastProblem: null, pending: 0 });
  expect(delivery?.lastSentAt).not.toBeNull();
});

it("merges the changes that follow a creation into one message with the newest facts", async () => {
  const world = await connectedWorld();

  // A template creates a ticket, then labels and checklist items change it again.
  await world.notifications.handle({ id: "t1", type: "ticket.created" });
  world.tickets.set(
    "t1",
    ticketFacts({ statusName: "Review", title: "Final title" }),
  );

  for (let change = 0; change < 5; change += 1) {
    await world.notifications.handle({ id: "t1", type: "ticket.updated" });
  }

  expect(world.deliveries.rows.size).toBe(1);
  await world.worker.runDue();
  expect(world.discord.messages).toHaveLength(1);
  expect(world.discord.messages[0]?.content).toContain("**Ticket created**");
  expect(world.discord.messages[0]?.content).toContain("Final title");
  expect(world.discord.messages[0]?.content).toContain("Status: Review");
});

it("merges repeated updates of one item and keeps other items apart", async () => {
  const world = await connectedWorld();

  world.tickets.set("t2", ticketFacts({ key: "PAGE-8", title: "Other" }));

  for (const id of ["t1", "t1", "t2", "t1"]) {
    await world.notifications.handle({ id, type: "ticket.updated" });
  }

  expect(world.deliveries.rows.size).toBe(2);
  await world.notifications.handle({ id: "m1", type: "milestone.created" });
  await world.notifications.handle({ id: "m1", type: "milestone.updated" });
  await world.notifications.handle({ id: "m1", type: "milestone.updated" });
  expect(world.deliveries.rows.size).toBe(3);
  await world.worker.runDue();
  expect(world.discord.messages).toHaveLength(3);
});

it("announces a change again once the earlier message was sent", async () => {
  const world = await connectedWorld();

  await world.notifications.handle({ id: "t1", type: "ticket.updated" });
  await world.worker.runDue();
  await world.notifications.handle({ id: "t1", type: "ticket.updated" });
  await world.worker.runDue();

  expect(world.discord.messages).toHaveLength(2);
});

it("keeps a heading or list syntax in a title from formatting the message", async () => {
  const world = await connectedWorld();

  for (const title of ["# Big", "-# Small", "- item", "1. first", "> quote"]) {
    world.tickets.set("t1", ticketFacts({ title }));
    world.deliveries.rows.clear();
    await world.notifications.handle({ id: "t1", type: "ticket.created" });
    await world.worker.runDue();

    const line = world.discord.messages.at(-1)?.content.split("\n")[1] ?? "";

    expect(line.startsWith("\u200B")).toBe(true);
    expect(line.startsWith("\u200B#")).toBe(title.startsWith("#"));
  }
});
