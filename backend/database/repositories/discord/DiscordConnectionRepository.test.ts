import { expect, it, vi } from "vitest";

import { DiscordConnectionRepository } from "./DiscordConnectionRepository";

import type { DiscordDatabase } from "./DiscordDatabase";

function doubleOf(rows: unknown[][] = []): {
  repository: DiscordConnectionRepository;
  query: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => rows);
  const execute = vi.fn(async () => undefined);
  const transaction = vi.fn(
    async (work: (inner: unknown) => Promise<unknown>) =>
      work({ query, execute }),
  );
  return {
    repository: new DiscordConnectionRepository({
      query,
      execute,
      transaction,
    } as unknown as DiscordDatabase),
    query,
    execute,
  };
}

const EVENTS = {
  "milestone.created": true,
  "milestone.updated": false,
  "ticket.created": true,
  "ticket.updated": false,
};

const NEW_CONNECTION = {
  projectId: "p1",
  guildId: "g1",
  guildName: "Guild",
  channelId: "c1",
  channelName: "general",
  baseUrl: "https://pages.test",
  events: EVENTS,
  connectedBy: "u1",
  now: "now",
};

it("maps a stored connection and returns null without a row", async () => {
  const { repository } = doubleOf([
    [
      "p1",
      "g1",
      "Guild",
      "c1",
      "general",
      "https://pages.test",
      1,
      0,
      1,
      0,
      "u1",
      "t1",
      "t2",
    ],
  ]);

  await expect(repository.findConnection("p1")).resolves.toEqual({
    projectId: "p1",
    guildId: "g1",
    guildName: "Guild",
    channelId: "c1",
    channelName: "general",
    baseUrl: "https://pages.test",
    events: {
      "ticket.created": true,
      "ticket.updated": false,
      "milestone.created": true,
      "milestone.updated": false,
    },
    connectedBy: "u1",
    connectedAt: "t1",
    updatedAt: "t2",
  });
  await expect(doubleOf().repository.findConnection("p1")).resolves.toBeNull();
});

it("inserts a new connection when none exists", async () => {
  const { repository, execute } = doubleOf();

  await repository.saveConnection(NEW_CONNECTION);

  expect(execute).toHaveBeenCalledTimes(1);
  expect(String(execute.mock.calls[0]?.[0])).toContain("INSERT INTO");
  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    project_id: "p1",
    notify_ticket_created: 1,
    notify_ticket_updated: 0,
    notify_milestone_created: 1,
    notify_milestone_updated: 0,
  });
});

it("updates the connection that already exists", async () => {
  const { repository, execute } = doubleOf([["p1"]]);

  await repository.saveConnection(NEW_CONNECTION);

  expect(String(execute.mock.calls[0]?.[0])).toContain("UPDATE");
});

it("updates the channel and the event switches", async () => {
  const { repository, execute } = doubleOf();

  await repository.updateChannel("p1", { id: "c2", name: "dev" }, "now");
  await repository.updateEvents("p1", EVENTS, "now");

  expect(execute.mock.calls[0]?.[1]).toEqual({
    channel_id: "c2",
    channel_name: "dev",
    now: "now",
    project_id: "p1",
  });
  expect(execute.mock.calls[1]?.[1]).toMatchObject({
    notify_ticket_created: 1,
    notify_milestone_updated: 0,
  });
});

it("deletes connection and deliveries and tells whether one existed", async () => {
  const existing = doubleOf([["p1"]]);
  await expect(existing.repository.deleteConnection("p1")).resolves.toBe(true);
  expect(existing.execute).toHaveBeenCalledTimes(2);

  await expect(doubleOf().repository.deleteConnection("p1")).resolves.toBe(
    false,
  );
});
