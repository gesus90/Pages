import { DiscordAttemptRepository } from "@/backend/database/repositories/discord/DiscordAttemptRepository";
import { DiscordConnectionRepository } from "@/backend/database/repositories/discord/DiscordConnectionRepository";
import { DiscordDeliveryRepository } from "@/backend/database/repositories/discord/DiscordDeliveryRepository";
import { DEFAULT_DISCORD_EVENTS } from "@/definition/Discord";

import {
  call,
  MISSING_TEXT,
  prepare,
  refused,
  reversedInPostgres,
  stored,
} from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";
import type { NewDiscordAttempt } from "@/backend/database/repositories/discord/DiscordAttemptRepository";
import type { NewDiscordConnection } from "@/backend/database/repositories/discord/DiscordConnectionRepository";
import type { NewDiscordDelivery } from "@/backend/database/repositories/discord/DiscordDeliveryRepository";

const PROJECT = "project-discord";
const USER = "user-discord";
const T1 = "2026-03-01T08:00:00.000Z";
const T2 = "2026-03-01T09:00:00.000Z";
const T3 = "2026-03-01T10:00:00.000Z";
const T4 = "2026-03-01T11:00:00.000Z";

const ATTEMPT: NewDiscordAttempt = {
  id: "attempt-a",
  stateHash: "state-a",
  projectId: PROJECT,
  userId: USER,
  baseUrl: "https://pages.example",
  createdAt: T1,
  expiresAt: T3,
};

const CONNECTION: NewDiscordConnection = {
  projectId: PROJECT,
  guildId: "guild-1",
  guildName: "Gilde ä",
  channelId: "channel-1",
  channelName: "allgemein",
  baseUrl: "https://pages.example",
  events: DEFAULT_DISCORD_EVENTS,
  connectedBy: USER,
  now: T1,
};

const DELIVERY: NewDiscordDelivery = {
  id: "delivery-b",
  projectId: PROJECT,
  eventType: "ticket.created",
  subjectKey: "/tasks/PAGE-1",
  contentJson: '{"title":"Erster Stand ä"}',
  now: T1,
};

function attempts({ database }: RepositoryWorld): DiscordAttemptRepository {
  return new DiscordAttemptRepository(database);
}

function connections({
  database,
}: RepositoryWorld): DiscordConnectionRepository {
  return new DiscordConnectionRepository(database);
}

function deliveries({ database }: RepositoryWorld): DiscordDeliveryRepository {
  return new DiscordDeliveryRepository(database);
}

/** Connection attempts: the state is used once, an attempt ends once. */
export const DISCORD_ATTEMPT_FLOW: RepositoryFlow = {
  title: "discord attempts",
  steps: [
    call("DiscordAttemptRepository.findAttempt", (world) =>
      attempts(world).findAttempt("attempt-a"),
    ),
    call("DiscordAttemptRepository.findLatestAttempt", (world) =>
      attempts(world).findLatestAttempt(PROJECT, USER),
    ),
    call("DiscordAttemptRepository.insertAttempt", (world) =>
      attempts(world).insertAttempt(ATTEMPT),
    ),
    call("DiscordAttemptRepository.findAttempt", (world) =>
      attempts(world).findAttempt("attempt-a"),
    ),
    call("DiscordAttemptRepository.findAttemptByStateHash", (world) =>
      attempts(world).findAttemptByStateHash("state-a"),
    ),
    call("DiscordAttemptRepository.findAttemptByStateHash", (world) =>
      attempts(world).findAttemptByStateHash("state-unknown"),
    ),
    refused("DiscordAttemptRepository.insertAttempt", (world) =>
      attempts(world).insertAttempt({ ...ATTEMPT, id: "attempt-same-state" }),
    ),
    call("DiscordAttemptRepository.findAttempt", (world) =>
      attempts(world).findAttempt("attempt-a"),
    ),
    call("DiscordAttemptRepository.claimByStateHash", (world) =>
      attempts(world).claimByStateHash("state-a", T4),
    ),
    call("DiscordAttemptRepository.recordAuthorization", (world) =>
      attempts(world).recordAuthorization("attempt-a", {
        id: "guild-1",
        name: "Zu früh",
      }),
    ),
    call("DiscordAttemptRepository.recordFailure", (world) =>
      attempts(world).recordFailure("attempt-a", "denied"),
    ),
    call("DiscordAttemptRepository.claimByStateHash", (world) =>
      attempts(world).claimByStateHash("state-a", T2),
    ),
    call("DiscordAttemptRepository.claimByStateHash", (world) =>
      attempts(world).claimByStateHash("state-a", T2),
    ),
    call("DiscordAttemptRepository.confirm", (world) =>
      attempts(world).confirm("attempt-a", T2),
    ),
    call("DiscordAttemptRepository.recordAuthorization", (world) =>
      attempts(world).recordAuthorization("attempt-a", {
        id: "guild-1",
        name: "Gilde ä",
      }),
    ),
    call("DiscordAttemptRepository.recordFailure", (world) =>
      attempts(world).recordFailure("attempt-a", "denied"),
    ),
    call("DiscordAttemptRepository.confirm", (world) =>
      attempts(world).confirm("attempt-a", T4),
    ),
    call("DiscordAttemptRepository.confirm", (world) =>
      attempts(world).confirm("attempt-a", T2),
    ),
    call("DiscordAttemptRepository.findAttempt", (world) =>
      attempts(world).findAttempt("attempt-a"),
    ),
    call("DiscordAttemptRepository.cancel", (world) =>
      attempts(world).cancel("attempt-a"),
    ),
    call("DiscordAttemptRepository.insertAttempt", (world) =>
      attempts(world).insertAttempt({
        ...ATTEMPT,
        id: "attempt-b",
        stateHash: "state-b",
        createdAt: T2,
      }),
    ),
    call("DiscordAttemptRepository.claimByStateHash", (world) =>
      attempts(world).claimByStateHash("state-b", T2),
    ),
    call("DiscordAttemptRepository.recordFailure", (world) =>
      attempts(world).recordFailure("attempt-b", "no_guild"),
    ),
    call("DiscordAttemptRepository.insertAttempt", (world) =>
      attempts(world).insertAttempt({
        ...ATTEMPT,
        id: "attempt-d",
        stateHash: "state-d",
        createdAt: T2,
      }),
    ),
    call("DiscordAttemptRepository.insertAttempt", (world) =>
      attempts(world).insertAttempt({
        ...ATTEMPT,
        id: "attempt-c",
        stateHash: "state-c",
        createdAt: T2,
      }),
    ),
    call("DiscordAttemptRepository.findAttempt", (world) =>
      attempts(world).findAttempt("attempt-d"),
    ),
    call("DiscordAttemptRepository.findLatestAttempt", (world) =>
      attempts(world).findLatestAttempt(PROJECT, USER),
    ),
    reversedInPostgres("discord_connection_attempts"),
    call("DiscordAttemptRepository.findLatestAttempt", (world) =>
      attempts(world).findLatestAttempt(PROJECT, USER),
    ),
    call("DiscordAttemptRepository.cancel", (world) =>
      attempts(world).cancel("attempt-c"),
    ),
    call("DiscordAttemptRepository.findAttempt", (world) =>
      attempts(world).findAttempt("attempt-c"),
    ),
    prepare(
      "UPDATE discord_connection_attempts SET failure = 'neuer Grund' WHERE id = 'attempt-b';",
    ),
    call("DiscordAttemptRepository.findAttempt", (world) =>
      attempts(world).findAttempt("attempt-b"),
    ),
    call("DiscordAttemptRepository.deleteExpired", (world) =>
      attempts(world).deleteExpired(T3),
    ),
    call("DiscordAttemptRepository.findAttempt", (world) =>
      attempts(world).findAttempt("attempt-c"),
    ),
    call("DiscordAttemptRepository.deleteExpired", (world) =>
      attempts(world).deleteExpired(T4),
    ),
    stored("SELECT COUNT(*) FROM discord_connection_attempts;"),
  ],
};

/** The connection of a project, with the switches of its four events. */
export const DISCORD_CONNECTION_FLOW: RepositoryFlow = {
  title: "discord connections",
  steps: [
    call("DiscordConnectionRepository.findConnection", (world) =>
      connections(world).findConnection(PROJECT),
    ),
    call("DiscordConnectionRepository.saveConnection", (world) =>
      connections(world).saveConnection(CONNECTION),
    ),
    call("DiscordConnectionRepository.findConnection", (world) =>
      connections(world).findConnection(PROJECT),
    ),
    call("DiscordConnectionRepository.saveConnection", (world) =>
      connections(world).saveConnection({
        ...CONNECTION,
        guildId: "guild-2",
        channelName: "zweiter Kanal",
        events: { ...DEFAULT_DISCORD_EVENTS, "ticket.updated": false },
        now: T2,
      }),
    ),
    call("DiscordConnectionRepository.findConnection", (world) =>
      connections(world).findConnection(PROJECT),
    ),
    refused("DiscordConnectionRepository.saveConnection", (world) =>
      connections(world).saveConnection({
        ...CONNECTION,
        projectId: "project-no-guild",
        guildId: MISSING_TEXT,
      }),
    ),
    call("DiscordConnectionRepository.updateChannel", (world) =>
      connections(world).updateChannel(
        PROJECT,
        { id: "channel-3", name: "dritter Kanal" },
        T3,
      ),
    ),
    refused("DiscordConnectionRepository.updateChannel", (world) =>
      connections(world).updateChannel(
        PROJECT,
        { id: "channel-3", name: MISSING_TEXT },
        T3,
      ),
    ),
    call("DiscordConnectionRepository.updateEvents", (world) =>
      connections(world).updateEvents(
        PROJECT,
        {
          "milestone.created": false,
          "milestone.updated": true,
          "ticket.created": false,
          "ticket.updated": true,
        },
        T4,
      ),
    ),
    call("DiscordConnectionRepository.findConnection", (world) =>
      connections(world).findConnection(PROJECT),
    ),
    prepare(`
      INSERT INTO discord_deliveries (
          id, project_id, event_type, subject_key, content_json, status,
          next_attempt_at, created_at, updated_at
      )
      VALUES (
          'delivery-of-connection', '${PROJECT}', 'ticket.created', '/tasks/PAGE-9', '{}',
          'pending', '${T1}', '${T1}', '${T1}'
      );
    `),
    call("DiscordConnectionRepository.deleteConnection", (world) =>
      connections(world).deleteConnection(PROJECT),
    ),
    call("DiscordConnectionRepository.deleteConnection", (world) =>
      connections(world).deleteConnection(PROJECT),
    ),
    call("DiscordConnectionRepository.findConnection", (world) =>
      connections(world).findConnection(PROJECT),
    ),
    stored(
      `SELECT COUNT(*) FROM discord_deliveries WHERE project_id = '${PROJECT}';`,
    ),
  ],
};

/** The outbox: merging, handing out, retries, the summary and the cleanup. */
export const DISCORD_DELIVERY_FLOW: RepositoryFlow = {
  title: "discord deliveries",
  steps: [
    call("DiscordDeliveryRepository.summarize", (world) =>
      deliveries(world).summarize(PROJECT),
    ),
    call("DiscordDeliveryRepository.claimDue", (world) =>
      deliveries(world).claimDue(T1, T2, 10),
    ),
    call("DiscordDeliveryRepository.enqueueDelivery", (world) =>
      deliveries(world).enqueueDelivery(DELIVERY),
    ),
    call("DiscordDeliveryRepository.enqueueDelivery", (world) =>
      deliveries(world).enqueueDelivery({
        ...DELIVERY,
        id: "delivery-merged",
        eventType: "ticket.updated",
        contentJson: '{"title":"Neuer Stand"}',
        now: T2,
      }),
    ),
    call("DiscordDeliveryRepository.enqueueDelivery", (world) =>
      deliveries(world).enqueueDelivery({
        ...DELIVERY,
        id: "delivery-other-event",
        eventType: "milestone.created",
        now: T1,
      }),
    ),
    call("DiscordDeliveryRepository.enqueueDelivery", (world) =>
      deliveries(world).enqueueDelivery({
        ...DELIVERY,
        id: "delivery-a",
        eventType: "milestone.created",
        contentJson: '{"title":"Gleiche Zeit"}',
        now: T1,
      }),
    ),
    reversedInPostgres("discord_deliveries"),
    // Three messages wait with the same time: the merge has to pick the same one.
    call("DiscordDeliveryRepository.enqueueDelivery", (world) =>
      deliveries(world).enqueueDelivery({
        ...DELIVERY,
        id: "delivery-merged-tie",
        eventType: "milestone.updated",
        contentJson: '{"title":"In die erste"}',
        now: T3,
      }),
    ),
    refused("DiscordDeliveryRepository.enqueueDelivery", (world) =>
      deliveries(world).enqueueDelivery({
        ...DELIVERY,
        subjectKey: "/tasks/PAGE-2",
      }),
    ),
    stored(`
      SELECT
          id,
          event_type,
          content_json,
          status,
          updated_at
      FROM discord_deliveries
      ORDER BY id;
    `),
    call("DiscordDeliveryRepository.summarize", (world) =>
      deliveries(world).summarize(PROJECT),
    ),
    call("DiscordDeliveryRepository.claimDue", (world) =>
      deliveries(world).claimDue(T4, T4, 2),
    ),
    reversedInPostgres("discord_deliveries"),
    call("DiscordDeliveryRepository.claimDue", (world) =>
      deliveries(world).claimDue(T4, T4, 2),
    ),
    call("DiscordDeliveryRepository.claimDue", (world) =>
      deliveries(world).claimDue(T4, T4, 2),
    ),
    call("DiscordDeliveryRepository.releaseExpiredLocks", (world) =>
      deliveries(world).releaseExpiredLocks(T4),
    ),
    call("DiscordDeliveryRepository.releaseExpiredLocks", (world) =>
      deliveries(world).releaseExpiredLocks("2026-03-01T12:00:00.000Z"),
    ),
    call("DiscordDeliveryRepository.claimDue", (world) =>
      deliveries(world).claimDue(T4, T4, 10),
    ),
    call("DiscordDeliveryRepository.markSent", (world) =>
      deliveries(world).markSent("delivery-a", T2),
    ),
    call("DiscordDeliveryRepository.summarize", (world) =>
      deliveries(world).summarize(PROJECT),
    ),
    call("DiscordDeliveryRepository.reschedule", (world) =>
      deliveries(world).reschedule("delivery-b", {
        attempts: 1,
        nextAttemptAt: T4,
        problem: "rate_limited",
        now: T3,
      }),
    ),
    call("DiscordDeliveryRepository.markFailed", (world) =>
      deliveries(world).markFailed("delivery-other-event", {
        attempts: 5,
        problem: "bot_removed",
        now: T3,
      }),
    ),
    // Two problems with the same time: the newest one is decided by the identifier.
    call("DiscordDeliveryRepository.summarize", (world) =>
      deliveries(world).summarize(PROJECT),
    ),
    reversedInPostgres("discord_deliveries"),
    call("DiscordDeliveryRepository.summarize", (world) =>
      deliveries(world).summarize(PROJECT),
    ),
    prepare(
      "UPDATE discord_deliveries SET last_problem = 'neues Problem' WHERE id = 'delivery-other-event';",
    ),
    call("DiscordDeliveryRepository.summarize", (world) =>
      deliveries(world).summarize(PROJECT),
    ),
    refused("DiscordDeliveryRepository.reschedule", (world) =>
      deliveries(world).reschedule("delivery-b", {
        attempts: 2,
        nextAttemptAt: MISSING_TEXT,
        problem: null,
        now: T3,
      }),
    ),
    refused("DiscordDeliveryRepository.markSent", (world) =>
      deliveries(world).markSent("delivery-b", MISSING_TEXT),
    ),
    prepare(`
      INSERT INTO discord_deliveries (
          id, project_id, event_type, subject_key, content_json, status,
          next_attempt_at, created_at, updated_at
      )
      VALUES (
          'delivery-invalid', 'project-discord-invalid', 'unbekannt', '/tasks/PAGE-3', '{}',
          'pending', '${T1}', '${T1}', '${T1}'
      );
    `),
    refused("DiscordDeliveryRepository.claimDue", (world) =>
      deliveries(world).claimDue(T1, T2, 10),
    ),
    call("DiscordDeliveryRepository.discard", (world) =>
      deliveries(world).discard("delivery-invalid"),
    ),
    call("DiscordDeliveryRepository.purge", (world) =>
      deliveries(world).purge({ sentBefore: T1, failedBefore: T1 }),
    ),
    stored("SELECT id, status FROM discord_deliveries ORDER BY id;"),
    call("DiscordDeliveryRepository.purge", (world) =>
      deliveries(world).purge({ sentBefore: T4, failedBefore: T1 }),
    ),
    stored("SELECT id, status FROM discord_deliveries ORDER BY id;"),
    call("DiscordDeliveryRepository.purge", (world) =>
      deliveries(world).purge({ sentBefore: T1, failedBefore: T4 }),
    ),
    stored("SELECT id, status FROM discord_deliveries ORDER BY id;"),
    call("DiscordDeliveryRepository.summarize", (world) =>
      deliveries(world).summarize(PROJECT),
    ),
  ],
};
