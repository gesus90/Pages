import { strict as assert } from "node:assert";

import { ConversationReplySettingsRepository } from "@/backend/database/repositories/conversation/ConversationReplySettingsRepository";
import { ConversationRoundRepository } from "@/backend/database/repositories/conversation/ConversationRoundRepository";

import type { Database } from "@/backend/database/Database";
import type { Migration } from "@/backend/database/Migration";
import type { ConversationReplyClaim } from "@/backend/database/repositories/conversation/ConversationRoundRepository";

/** The migration of PAGE-337/PAGE-349 that this check runs on a database of stand 056. */
export const HANDOFF_MIGRATION = "057_conversation_follow_ups.sql";

const NOW = "2026-11-13T10:00:00.000Z";

/** A database at stand 056 with a round in the old shape: one target per origin and agent. */
async function seedStand056(database: Database): Promise<void> {
  await database.execute(
    `
      INSERT INTO conversations (id, kind, name, created_by, created_at, last_activity_at)
      VALUES ('group', 'group', 'Team', 'person', $now, $now);
    `,
    { now: NOW },
  );
  await database.execute(
    `
      INSERT INTO conversation_reply_settings (
          conversation_id, mode, default_responder_id, max_responders, updated_by, updated_at
      )
      VALUES ('group', 'mentions', NULL, 2, 'person', $now);
    `,
    { now: NOW },
  );
  for (const [id, sender] of [
    ["origin", "person"],
    ["answer-a", "a"],
    ["answer-b", "b"],
    ["answer-c", "c"],
  ] as const)
    await database.execute(
      `
        INSERT INTO conversation_messages (id, conversation_id, sender_id, client_message_id, text, created_at)
        VALUES ($id, 'group', $sender, $id, $id, $now);
      `,
      { id, sender, now: NOW },
    );
  await database.execute(
    `
      INSERT INTO conversation_reply_rounds (origin_message_id, conversation_id, person_id, automatic_count, created_at)
      VALUES ('origin', 'group', 'person', 3, $now);
    `,
    { now: NOW },
  );
  await database.execute(
    `
      INSERT INTO conversation_reply_targets (
          origin_message_id, agent_id, conversation_id, trigger, trigger_message_id,
          is_automatic, state, reply_message_id, created_at, updated_at
      )
      VALUES ('origin', 'a', 'group', 'mention', 'origin', FALSE, 'answered', 'answer-a', $now, $now),
             ('origin', 'b', 'group', 'handoff', 'answer-a', TRUE, 'answered', 'answer-b', $now, $now);
    `,
    { now: NOW },
  );
}

async function checkMigration(database: Database): Promise<void> {
  const [settings] = await database.query(
    "SELECT replies_per_round FROM conversation_reply_settings WHERE conversation_id = 'group';",
  );
  assert.equal(Number(settings?.[0]), 8, "existing groups get eight places without @");
  const [targets] = await database.query(
    "SELECT COUNT(*) FROM conversation_reply_targets WHERE origin_message_id = 'origin';",
  );
  assert.equal(Number(targets?.[0]), 2, "existing targets survive the new key");
  const tables = await database.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_name IN (
        'conversation_handoff_requests',
        'conversation_follow_up_questions',
        'conversation_follow_up_answers'
    )
    ORDER BY table_name;
  `);
  assert.equal(tables.length, 3, "the new tables exist");
  const columns = await database.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'conversation_reply_settings' AND column_name = 'replies_per_agent';
  `);
  assert.equal(columns.length, 0, "no limit per agent is stored");
  await database.execute(
    `
      INSERT INTO conversation_messages (id, conversation_id, sender_id, client_message_id, text, created_at, notice)
      VALUES ('hint', 'group', 'a', 'round-limit-origin', 'Hinweis', $now, 'round_limit');
    `,
    { now: NOW },
  );
}

function claim(
  overrides: Partial<ConversationReplyClaim>,
): ConversationReplyClaim {
  return {
    originMessageId: "origin",
    conversationId: "group",
    personId: "person",
    createdAt: NOW,
    agentId: "a",
    trigger: "handoff",
    triggerMessageId: "answer-c",
    requestedBy: "c",
    reason: "C hat dich angesprochen.",
    isAutomatic: false,
    ...overrides,
  };
}

/** Concurrent claims of one trigger and agent: exactly one wins, on real row locks and the unique key. */
async function checkAtomicClaims(database: Database): Promise<void> {
  const rounds = new ConversationRoundRepository(database);
  // A answered the round before; C's mention starts it again, exactly once.
  const outcomes = await Promise.all(
    Array.from({ length: 8 }, () => rounds.claim(claim({}))),
  );
  assert.deepEqual(
    outcomes.filter((outcome) => outcome === "claimed").length,
    1,
    `exactly one concurrent claim wins: ${outcomes.join(", ")}`,
  );
  assert.equal(await rounds.claim(claim({})), "duplicate");
  // A self mention starts nothing.
  assert.equal(
    await rounds.claim(
      claim({ agentId: "c", triggerMessageId: "answer-b", requestedBy: "b" }),
    ),
    "claimed",
  );
  assert.equal(
    await rounds.claim(
      claim({ agentId: "c", requestedBy: "c", triggerMessageId: "answer-c" }),
    ),
    "duplicate",
  );
  // A stored hand-over is taken once, also by concurrent jobs.
  await rounds.handoffs.request([
    {
      triggerMessageId: "answer-c",
      agentId: "b",
      originMessageId: "origin",
      conversationId: "group",
      personId: "person",
      requestedBy: "c",
      reason: "C",
      state: "pending",
      pauseReason: null,
      createdAt: NOW,
    },
  ]);
  const taken = await Promise.all(
    Array.from({ length: 6 }, () =>
      rounds.claim(claim({ agentId: "b", handoff: "pending" })),
    ),
  );
  assert.equal(taken.filter((outcome) => outcome === "claimed").length, 1);
  // Contributions without @: eight at most, @ hand-overs do not count.
  const [round] = await database.query(
    "SELECT automatic_count FROM conversation_reply_rounds WHERE origin_message_id = 'origin';",
  );
  assert.equal(Number(round?.[0]), 3, "@ hand-overs left the count alone");
  const automatic = await Promise.all(
    ["d", "e", "f", "g", "h", "i", "j"].map((agentId) =>
      rounds.claim(
        claim({
          agentId,
          trigger: "context",
          triggerMessageId: "origin",
          requestedBy: null,
          isAutomatic: true,
        }),
      ),
    ),
  );
  assert.equal(automatic.filter((outcome) => outcome === "claimed").length, 5);
  assert.equal(automatic.filter((outcome) => outcome === "limit").length, 2);
  const settings = await new ConversationReplySettingsRepository(database).find(
    "group",
  );
  assert.equal(settings.automaticRepliesPerOrigin, 8);
}

/** A restart pauses stored and claimed-but-queued hand-overs; the next person resumes each once. */
async function checkRestartResume(database: Database): Promise<void> {
  const rounds = new ConversationRoundRepository(database);
  await database.execute(
    `
      INSERT INTO conversation_messages (id, conversation_id, sender_id, client_message_id, text, created_at)
      VALUES ('answer-d', 'group', 'd', 'answer-d', '@e @f', $now);
    `,
    { now: NOW },
  );
  const base = {
    triggerMessageId: "answer-d",
    originMessageId: "origin",
    conversationId: "group",
    personId: "person",
    requestedBy: "d",
    reason: "D",
    state: "pending" as const,
    pauseReason: null,
    createdAt: NOW,
  };
  await rounds.handoffs.request([
    { ...base, agentId: "e" },
    { ...base, agentId: "f" },
  ]);
  // B of the earlier check answered; it is not resumed.
  await rounds.setTargetState(
    { originMessageId: "origin", agentId: "b", triggerMessageId: "answer-c" },
    { state: "answered", updatedAt: NOW },
  );
  // F was claimed but never ran before the crash; E was never claimed.
  assert.equal(
    await rounds.claim(
      claim({ agentId: "f", triggerMessageId: "answer-d", requestedBy: "d", handoff: "pending" }),
    ),
    "claimed",
  );
  const paused = await rounds.handoffs.pauseUnstarted("2026-11-13T11:00:00.000Z");
  assert.deepEqual(paused.map((entry) => entry.agentId).sort(), ["e", "f"]);
  assert.equal(
    await rounds.interruptStale("2026-11-13T11:00:00.000Z") >= 0,
    true,
  );
  assert.deepEqual(
    (await rounds.handoffs.paused("group")).map((entry) => entry.agentId).sort(),
    ["e", "f"],
  );
  const resumed = await Promise.all(
    ["e", "f", "e", "f"].map((agentId) =>
      rounds.claim(
        claim({
          agentId,
          triggerMessageId: "answer-d",
          requestedBy: "d",
          handoff: "paused",
          createdAt: "2026-11-13T11:01:00.000Z",
        }),
      ),
    ),
  );
  assert.equal(resumed.filter((outcome) => outcome === "claimed").length, 2);
  assert.deepEqual(await rounds.handoffs.paused("group"), []);
  const [states] = await database.query(`
    SELECT string_agg(agent_id || ':' || state, ',' ORDER BY agent_id)
    FROM conversation_reply_targets WHERE trigger_message_id = 'answer-d';
  `);
  assert.equal(states?.[0], "e:queued,f:queued");
}

/** Bundled replies: recorded under a lock, the batch consumed once, the bundled trigger refused. */
async function checkBundles(database: Database): Promise<void> {
  const rounds = new ConversationRoundRepository(database);
  await database.execute(
    `
      INSERT INTO conversation_messages (id, conversation_id, sender_id, client_message_id, text, created_at)
      VALUES ('question-g', 'group', 'g', 'question-g', '@h', $now),
             ('reply-h', 'group', 'h', 'reply-h', '@g', $now);
    `,
    { now: NOW },
  );
  await rounds.followUps.open({
    questionMessageId: "question-g",
    originMessageId: "origin",
    conversationId: "group",
    agentId: "g",
    askedAgentIds: ["h"],
    deadlineAt: "2026-11-13T10:03:00.000Z",
  });
  const recorded = await rounds.followUps.record("origin", {
    id: "reply-h",
    senderId: "h",
    mentions: ["g", "h"],
  });
  assert.deepEqual([...recorded], ["g"]);
  assert.deepEqual(
    [...(await rounds.followUps.record("origin", { id: "reply-h", senderId: "h", mentions: ["g"] }))],
    ["g"],
    "a repeated record still reports the batch",
  );
  assert.equal(
    await rounds.claim(
      claim({ agentId: "g", triggerMessageId: "reply-h", requestedBy: "h" }),
    ),
    "duplicate",
    "a bundled reply starts no separate hand-over",
  );
  const continuations = await Promise.all(
    Array.from({ length: 4 }, () =>
      rounds.claim(
        claim({
          agentId: "g",
          triggerMessageId: "question-g",
          requestedBy: null,
          isFollowUp: true,
        }),
      ),
    ),
  );
  assert.equal(continuations.filter((outcome) => outcome === "claimed").length, 1);
}

/**
 * Runs the checks of PAGE-349 against a real server: the migration from stand
 * 056 and the atomic double protection of hand-overs.
 *
 * @param database - An empty database.
 * @param migrations - All migrations in name order.
 */
export async function runConversationHandoffChecks(
  database: Database,
  migrations: readonly Migration[],
): Promise<string[]> {
  const index = migrations.findIndex(
    (migration) => migration.name === HANDOFF_MIGRATION,
  );
  assert.ok(index > 0, `${HANDOFF_MIGRATION} is missing`);
  const stand056 = migrations.slice(0, index);
  assert.equal(stand056.at(-1)?.name.slice(0, 3), "056");
  await database.migrate(stand056);
  await seedStand056(database);
  await database.migrate(migrations.slice(0, index + 1));
  await checkMigration(database);
  const passed = ["migration 057 runs on a database of stand 056"];
  await database.migrate(migrations);
  await checkAtomicClaims(database);
  passed.push("concurrent claims start an agent once per trigger");
  await checkRestartResume(database);
  passed.push("a restart pauses unstarted hand-overs and resumes each once");
  await checkBundles(database);
  passed.push("bundled replies are guarded and a batch continues once");
  return passed;
}
