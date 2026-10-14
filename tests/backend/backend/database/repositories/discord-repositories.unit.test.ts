import { expect, it, vi } from "vitest";

import { DiscordAttemptRepository } from "@/backend/database/repositories/discord/DiscordAttemptRepository";
import { DiscordConnectionRepository } from "@/backend/database/repositories/discord/DiscordConnectionRepository";
import { DiscordDeliveryRepository } from "@/backend/database/repositories/discord/DiscordDeliveryRepository";
import { DEFAULT_DISCORD_EVENTS } from "@/definition/Discord";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { DiscordDatabase } from "@/backend/database/repositories/discord/DiscordDatabase";

function boundary(): DiscordDatabase {
  const connection: DatabaseTransaction = {
    execute: vi.fn<DatabaseTransaction["execute"]>().mockResolvedValue(),
    query: vi.fn<DatabaseTransaction["query"]>().mockResolvedValue([]),
  };

  return { ...connection, transaction: async (work) => work(connection) };
}

const ATTEMPT_ROW = [
  "attempt",
  "hash",
  "alpha",
  "owner",
  "https://pages.example.test",
  "authorized",
  "verification_failed",
  "300",
  "Team",
  "2026-10-15T10:00:00.000Z",
  "2026-10-15T10:15:00.000Z",
  null,
];

it("claims a state only while its attempt waits, is unused and unexpired", async () => {
  const database = boundary();

  vi.mocked(database.query).mockResolvedValue([ATTEMPT_ROW]);

  const attempt = await new DiscordAttemptRepository(database).claimByStateHash(
    "hash",
    "2026-10-15T10:05:00.000Z",
  );
  const [statement, parameters] = vi.mocked(database.query).mock.calls[0] ?? [];

  expect(attempt).toMatchObject({
    failure: "verification_failed",
    id: "attempt",
  });
  expect(statement).toContain("SET consumed_at = $now");
  expect(statement).toContain("AND status = 'pending'");
  expect(statement).toContain("AND consumed_at IS NULL");
  expect(statement).toContain("AND expires_at > $now");
  expect(statement).toContain("RETURNING");
  expect(parameters).toEqual({
    now: "2026-10-15T10:05:00.000Z",
    state_hash: "hash",
  });
});

it("reports a refused claim as nothing", async () => {
  const database = boundary();

  await expect(
    new DiscordAttemptRepository(database).claimByStateHash("hash", "now"),
  ).resolves.toBeNull();
});

it("confirms an attempt only once and only while authorized and unexpired", async () => {
  const database = boundary();
  const repository = new DiscordAttemptRepository(database);

  await expect(repository.confirm("attempt", "now")).resolves.toBe(false);

  vi.mocked(database.query).mockResolvedValue([["attempt"]]);
  await expect(repository.confirm("attempt", "now")).resolves.toBe(true);

  const statement = vi.mocked(database.query).mock.calls[0]?.[0];

  expect(statement).toContain("AND status = 'authorized'");
  expect(statement).toContain("AND expires_at > $now");
});

it("cancels the open attempts of the same user and project when it stores a new one", async () => {
  const database = boundary();
  const executed: string[] = [];

  vi.mocked(database.execute).mockImplementation(async (statement) => {
    executed.push(statement);
  });
  await new DiscordAttemptRepository(database).insertAttempt({
    baseUrl: "https://pages.example.test",
    createdAt: "a",
    expiresAt: "b",
    id: "attempt",
    projectId: "alpha",
    stateHash: "hash",
    userId: "owner",
  });
  // Statements run inside the transaction, so they are recorded on the shared mock.
  expect(executed).toHaveLength(2);
  expect(executed[0]).toContain("SET status = 'cancelled'");
  expect(executed[0]).toContain("status IN ('pending', 'authorized')");
  expect(executed[1]).toContain("INSERT INTO discord_connection_attempts");
});

it("never stores a state, only its hash, and binds every value", async () => {
  const database = boundary();

  await new DiscordAttemptRepository(database).insertAttempt({
    baseUrl: "https://pages.example.test",
    createdAt: "a",
    expiresAt: "b",
    id: "attempt",
    projectId: "alpha",
    stateHash: "hash",
    userId: "owner",
  });

  const calls = vi.mocked(database.execute).mock.calls;
  const insert = calls[1];

  expect(insert?.[0]).toContain("state_hash");
  expect(insert?.[0]).not.toMatch(/'[^']*alpha[^']*'/);
  expect(insert?.[1]).toMatchObject({ state_hash: "hash", user_id: "owner" });
});

it("removes the connection of one project together with every stored message", async () => {
  const database = boundary();

  vi.mocked(database.query).mockResolvedValue([["alpha"]]);

  await expect(
    new DiscordConnectionRepository(database).deleteConnection("alpha"),
  ).resolves.toBe(true);

  const calls = vi.mocked(database.execute).mock.calls;

  expect(calls.map(([statement]) => statement)).toEqual([
    "DELETE FROM project_discord_connections WHERE project_id = $project_id;",
    expect.stringContaining("DELETE FROM discord_deliveries"),
  ]);
  // Sent and failed messages go too, so a new connection starts without old counters.
  expect(calls[1]?.[0]).not.toContain("status");
  expect(calls.map(([, parameters]) => parameters)).toEqual([
    { project_id: "alpha" },
    { project_id: "alpha" },
  ]);
});

it("reports a disconnect of a project without a connection", async () => {
  const database = boundary();

  await expect(
    new DiscordConnectionRepository(database).deleteConnection("alpha"),
  ).resolves.toBe(false);
});

it("inserts a new connection and updates an existing one, with the four switches", async () => {
  const database = boundary();
  const repository = new DiscordConnectionRepository(database);
  const connection = {
    baseUrl: "https://pages.example.test",
    channelId: "201",
    channelName: "general",
    connectedBy: "owner",
    events: { ...DEFAULT_DISCORD_EVENTS, "ticket.updated": false },
    guildId: "300",
    guildName: "Team",
    now: "now",
    projectId: "alpha",
  };

  await repository.saveConnection(connection);
  vi.mocked(database.query).mockResolvedValue([["alpha"]]);
  await repository.saveConnection(connection);

  const [insert, update] = vi.mocked(database.execute).mock.calls;

  expect(insert?.[0]).toContain("INSERT INTO project_discord_connections");
  expect(update?.[0]).toContain("UPDATE project_discord_connections");
  expect(insert?.[1]).toMatchObject({
    notify_milestone_created: 1,
    notify_milestone_updated: 1,
    notify_ticket_created: 1,
    notify_ticket_updated: 0,
  });
});

it("hands out due deliveries by locking them in one statement", async () => {
  const database = boundary();

  vi.mocked(database.query).mockResolvedValue([
    ["d2", "alpha", "ticket.updated", "{}", 1, "2026-10-15T10:00:02.000Z"],
    ["d1", "alpha", "ticket.created", "{}", 0n, "2026-10-15T10:00:01.000Z"],
  ]);

  const claimed = await new DiscordDeliveryRepository(database).claimDue(
    "now",
    "later",
    5.9,
  );
  const statement = vi.mocked(database.query).mock.calls[0]?.[0];

  expect(claimed.map((delivery) => delivery.id)).toEqual(["d1", "d2"]);
  expect(claimed[0]?.attempts).toBe(0);
  expect(statement).toContain("status = 'sending'");
  expect(statement).toContain("WHERE status = 'pending'");
  expect(statement).toContain("AND next_attempt_at <= $now");
  expect(statement).toContain("LIMIT 5");
  expect(statement).toContain("RETURNING");
});

it("sums up the deliveries of a project and names the problem still standing", async () => {
  const database = boundary();

  vi.mocked(database.query)
    .mockResolvedValueOnce([[2n, 1n, "2026-10-15T10:00:00.000Z"]])
    .mockResolvedValueOnce([["missing_permissions"]]);

  await expect(
    new DiscordDeliveryRepository(database).summarize("alpha"),
  ).resolves.toEqual({
    failed: 1,
    lastProblem: "missing_permissions",
    lastSentAt: "2026-10-15T10:00:00.000Z",
    pending: 2,
  });
  expect(vi.mocked(database.query).mock.calls[1]?.[1]).toEqual({
    after: "2026-10-15T10:00:00.000Z",
    project_id: "alpha",
  });
});

it("rejects a stored value that is not an event type", async () => {
  const database = boundary();

  vi.mocked(database.query).mockResolvedValue([
    ["d1", "alpha", "wiki.page.created", "{}", 0, "t"],
  ]);

  await expect(
    new DiscordDeliveryRepository(database).claimDue("now", "later", 1),
  ).rejects.toThrow("event_type");
});

it("stores the verified server only for an attempt whose state is claimed and still pending", async () => {
  const database = boundary();
  const repository = new DiscordAttemptRepository(database);

  await expect(
    repository.recordAuthorization("attempt", { id: "300", name: "Team" }),
  ).resolves.toBe(false);

  vi.mocked(database.query).mockResolvedValue([["attempt"]]);
  await expect(
    repository.recordAuthorization("attempt", { id: "300", name: "Team" }),
  ).resolves.toBe(true);
  await expect(repository.recordFailure("attempt", "denied")).resolves.toBe(
    true,
  );

  for (const [statement] of vi.mocked(database.query).mock.calls) {
    expect(statement).toContain("AND status = 'pending'");
    expect(statement).toContain("AND consumed_at IS NOT NULL");
    expect(statement).toContain("RETURNING id");
  }
});

const DELIVERY = {
  contentJson: '{"title":"New"}',
  eventType: "ticket.updated",
  id: "d2",
  now: "2026-10-15T10:00:05.000Z",
  projectId: "alpha",
  subjectKey: "/tasks/PAGE-7",
} as const;

it("adds a message to the outbox when none about the same item waits", async () => {
  const database = boundary();

  await new DiscordDeliveryRepository(database).enqueueDelivery(DELIVERY);

  const [statement, parameters] =
    vi.mocked(database.execute).mock.calls[0] ?? [];

  expect(vi.mocked(database.query).mock.calls[0]?.[1]).toEqual({
    project_id: "alpha",
    subject_key: "/tasks/PAGE-7",
  });
  expect(statement).toContain("INSERT INTO discord_deliveries");
  expect(parameters).toMatchObject({ id: "d2", subject_key: "/tasks/PAGE-7" });
});

it("merges an update into the message about the same item that still waits", async () => {
  const database = boundary();

  vi.mocked(database.query).mockResolvedValue([["d1", "ticket.created"]]);
  await new DiscordDeliveryRepository(database).enqueueDelivery(DELIVERY);

  const calls = vi.mocked(database.execute).mock.calls;

  expect(calls).toHaveLength(1);
  expect(calls[0]?.[0]).toContain("UPDATE discord_deliveries");
  expect(calls[0]?.[0]).toContain("content_json = $content_json");
  expect(calls[0]?.[1]).toEqual({
    content_json: '{"title":"New"}',
    id: "d1",
    now: "2026-10-15T10:00:05.000Z",
  });
  expect(vi.mocked(database.query).mock.calls[0]?.[0]).toContain(
    "status = 'pending'",
  );
});

it("does not merge a creation into a waiting update", async () => {
  const database = boundary();

  vi.mocked(database.query).mockResolvedValue([["d1", "ticket.updated"]]);
  await new DiscordDeliveryRepository(database).enqueueDelivery({
    ...DELIVERY,
    eventType: "ticket.created",
  });

  expect(vi.mocked(database.execute).mock.calls[0]?.[0]).toContain(
    "INSERT INTO",
  );
});
