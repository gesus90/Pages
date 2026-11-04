import {
  appendSessionHistoryChunks,
  readSessionHistoryChunks,
} from "@/backend/database/repositories/agent/AgentSessionHistoryChunks";
import { AgentSessionRepository } from "@/backend/database/repositories/agent/AgentSessionRepository";
import {
  ATTEMPT_COLUMNS,
  MESSAGE_COLUMNS,
  readAttemptRow,
  readEventRow,
  readMessageRow,
  readUsageRow,
  USAGE_COLUMNS,
} from "@/backend/database/repositories/agent/AgentSessionRows";
import { PageAgentRunRepository } from "@/backend/database/repositories/agent/PageAgentRunRepository";

import { callAtAnyTime, OWNER, STARTED_AT } from "./plan-fixtures";
import {
  call,
  MISSING_TEXT,
  prepare,
  refused,
  reversedInPostgres,
  stored,
} from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";
import type { AgentSessionAttemptRecord } from "@/backend/service/agents/sessions/AgentSessionStore";
import type { AgentSessionTurnUsage } from "@/definition/AgentSessionJournal";
import type { PageAgentRunRecord } from "@/definition/PageAgent";

const ATTEMPT_ID = "attempt-session";

const ATTEMPT: AgentSessionAttemptRecord = {
  key: {
    attemptId: ATTEMPT_ID,
    planId: "plan-session",
    runId: "run-session",
    stepId: "review",
  },
  userId: OWNER,
  provider: "codex_cli",
  instanceId: "instance-session",
  groupId: null,
  state: "running",
  context: {
    contextUsed: null,
    contextLimit: null,
    percent: null,
    source: null,
    reportedAt: null,
  },
  confirmedModel: { value: null, source: null, reportedAt: null },
  confirmedReasoning: { value: null, source: null, reportedAt: null },
  workspace: null,
  updatedAt: STARTED_AT,
};

const CHANGED_ATTEMPT: AgentSessionAttemptRecord = {
  ...ATTEMPT,
  state: "idle",
  groupId: "ignored-after-the-first-save",
  context: {
    contextUsed: 500,
    contextLimit: 1000,
    percent: 50,
    source: "acp_usage_update",
    reportedAt: STARTED_AT,
  },
  confirmedModel: {
    value: "model-a",
    source: "acp_config_option",
    reportedAt: STARTED_AT,
  },
  confirmedReasoning: {
    value: "high",
    source: "plan",
    reportedAt: STARTED_AT,
  },
  workspace: {
    directory: "/srv/plans",
    git: { state: "branch", branch: "main" },
    checkedAt: STARTED_AT,
  },
};

const USAGE: AgentSessionTurnUsage = {
  attemptId: ATTEMPT_ID,
  turn: 1,
  provider: "codex_cli",
  model: "model-a",
  inputTokens: 10,
  outputTokens: 20,
  cacheReadTokens: null,
  cacheWriteTokens: 3,
  totalTokens: 9_007_199_254_740_991,
  inputIncludesCache: null,
  isPartial: false,
  reportedAt: STARTED_AT,
};

const RUN_RECORD: PageAgentRunRecord = {
  agentId: "agent-record",
  runId: "run-record",
  planRunId: "plan-run-record",
  userId: OWNER,
  startedAt: STARTED_AT,
  finishedAt: STARTED_AT,
  status: "succeeded",
  model: "model-a",
  reasoningEffort: null,
  input: "Eingabe mit Umlaut ä",
  result: "Ergebnis",
};

function sessions({ database }: RepositoryWorld): AgentSessionRepository {
  return new AgentSessionRepository(database);
}

function records({ database }: RepositoryWorld): PageAgentRunRepository {
  return new PageAgentRunRepository(database);
}

function newEvent(
  text: string,
  dedupeKey: string | null = null,
): {
  readonly turn: number | null;
  readonly kind: "agent_message";
  readonly text: string;
  readonly isTruncated: boolean;
  readonly createdAt: string;
  readonly dedupeKey: string | null;
} {
  return {
    turn: 1,
    kind: "agent_message",
    text,
    isTruncated: false,
    createdAt: STARTED_AT,
    dedupeKey,
  };
}

/** Attempts, events with retention, usage and instructions of a session. */
export const AGENT_SESSION_FLOW: RepositoryFlow = {
  title: "agent sessions",
  steps: [
    call("AgentSessionRepository.findAttempt", (world) =>
      sessions(world).findAttempt(ATTEMPT_ID),
    ),
    refused("AgentSessionRepository.appendEvents", (world) =>
      sessions(world).appendEvents(ATTEMPT_ID, [newEvent("Text")], 100),
    ),
    call("AgentSessionRepository.saveAttempt", (world) =>
      sessions(world).saveAttempt(ATTEMPT),
    ),
    call("AgentSessionRepository.findAttempt", (world) =>
      sessions(world).findAttempt(ATTEMPT_ID),
    ),
    call("AgentSessionRepository.saveAttempt", (world) =>
      sessions(world).saveAttempt(CHANGED_ATTEMPT),
    ),
    call("AgentSessionRepository.findAttempt", (world) =>
      sessions(world).findAttempt(ATTEMPT_ID),
    ),
    refused("AgentSessionRepository.saveAttempt", (world) =>
      sessions(world).saveAttempt({
        ...ATTEMPT,
        key: { ...ATTEMPT.key, attemptId: "attempt-invalid" },
        userId: MISSING_TEXT,
      }),
    ),
    call("AgentSessionRepository.readEvents", (world) =>
      sessions(world).readEvents(ATTEMPT_ID, 0, 10),
    ),
    call("AgentSessionRepository.readWindow", (world) =>
      sessions(world).readWindow(ATTEMPT_ID, { after: 0, limit: 10 }),
    ),
    call("AgentSessionRepository.appendEvents", (world) =>
      sessions(world).appendEvents(
        ATTEMPT_ID,
        [
          newEvent("Erste Zeile", "key-1"),
          newEvent("Zweite Zeile mit Umlaut ü"),
          newEvent("Doppelt", "key-1"),
          { ...newEvent("Dritte"), turn: null, isTruncated: true },
        ],
        100,
      ),
    ),
    call("AgentSessionRepository.appendEvents", (world) =>
      sessions(world).appendEvents(
        ATTEMPT_ID,
        [newEvent("Wieder doppelt", "key-1")],
        100,
      ),
    ),
    call("AgentSessionRepository.appendEvents", (world) =>
      sessions(world).appendEvents(ATTEMPT_ID, [], 100),
    ),
    reversedInPostgres("agent_session_events"),
    reversedInPostgres("agent_session_history_chunks"),
    call("AgentSessionRepository.readEvents", (world) =>
      sessions(world).readEvents(ATTEMPT_ID, 0, 10),
    ),
    call("AgentSessionRepository.readEvents", (world) =>
      sessions(world).readEvents(ATTEMPT_ID, 1, 1),
    ),
    call("AgentSessionRepository.readWindow", (world) =>
      sessions(world).readWindow(ATTEMPT_ID, { after: 1, limit: 1 }),
    ),
    call("AgentSessionRepository.readWindow", (world) =>
      sessions(world).readWindow(ATTEMPT_ID, {
        after: 0,
        limit: 2,
        tail: true,
      }),
    ),
    call("AgentSessionRepository.readWindow", (world) =>
      sessions(world).readWindow(ATTEMPT_ID, {
        after: 0,
        limit: 1,
        before: 3,
      }),
    ),
    refused("AgentSessionRepository.readWindow", (world) =>
      sessions(world).readWindow(ATTEMPT_ID, { after: 99, limit: 1 }),
    ),
    call("AgentSessionRepository.appendEvents", (world) =>
      sessions(world).appendEvents(ATTEMPT_ID, [newEvent("Vierte")], 2),
    ),
    call("AgentSessionRepository.readEvents", (world) =>
      sessions(world).readEvents(ATTEMPT_ID, 0, 10),
    ),
    prepare(
      "UPDATE agent_session_history_chunks SET events_jsonl = 'verändert' WHERE attempt_id = $id;",
      { id: ATTEMPT_ID },
    ),
    refused("AgentSessionRepository.readWindow", (world) =>
      sessions(world).readWindow(ATTEMPT_ID, { after: 0, limit: 1 }),
    ),
    prepare(
      "DELETE FROM agent_session_history_chunks WHERE attempt_id = $id;",
      {
        id: ATTEMPT_ID,
      },
    ),
    call("AgentSessionRepository.readWindow", (world) =>
      sessions(world).readWindow(ATTEMPT_ID, { after: 0, limit: 1 }),
    ),
    call("AgentSessionRepository.readWindow", (world) =>
      sessions(world).readWindow(ATTEMPT_ID, {
        after: 0,
        limit: 1,
        tail: true,
      }),
    ),
    call("appendSessionHistoryChunks", ({ database }) =>
      database.transaction((transaction) =>
        appendSessionHistoryChunks(
          transaction,
          { attemptId: "attempt-chunks", launchId: "launch-1" },
          [],
        ),
      ),
    ),
    call("appendSessionHistoryChunks", ({ database }) =>
      database.transaction((transaction) =>
        appendSessionHistoryChunks(
          transaction,
          { attemptId: ATTEMPT_ID, launchId: "launch-1" },
          [
            {
              id: `${ATTEMPT_ID}:5`,
              sequence: 5,
              stepId: "review",
              attemptId: ATTEMPT_ID,
              turn: 1,
              kind: "status",
              createdAt: STARTED_AT,
              text: "Bestehender Anfang",
              isTruncated: false,
            },
          ],
        ),
      ),
    ),
    call("readSessionHistoryChunks", ({ database }) =>
      database.transaction((transaction) =>
        readSessionHistoryChunks(transaction, ATTEMPT_ID, {
          after: 0,
          limit: 20,
        }),
      ),
    ),
    call("readSessionHistoryChunks", ({ database }) =>
      database.transaction((transaction) =>
        readSessionHistoryChunks(transaction, "attempt-none", {
          after: 0,
          limit: 20,
        }),
      ),
    ),
    refused("appendSessionHistoryChunks", ({ database }) =>
      database.transaction((transaction) =>
        appendSessionHistoryChunks(
          transaction,
          { attemptId: ATTEMPT_ID, launchId: "launch-other" },
          [
            {
              id: `${ATTEMPT_ID}:6`,
              sequence: 6,
              stepId: "review",
              attemptId: ATTEMPT_ID,
              turn: 1,
              kind: "status",
              createdAt: STARTED_AT,
              text: "Anderer Start",
              isTruncated: false,
            },
          ],
        ),
      ),
    ),
    call("readEventRow", async ({ database }) =>
      (
        await database.query(`
          SELECT
              events.sequence,
              events.turn,
              events.kind,
              events.body,
              events.is_truncated,
              events.created_at,
              'review'
          FROM agent_session_events AS events
          WHERE events.attempt_id = 'attempt-session'
          ORDER BY events.sequence;
        `)
      ).map((row) => readEventRow(row, ATTEMPT_ID)),
    ),
    refused("readEventRow", async () =>
      readEventRow(
        [1, 1, "unknown", "Text", 0, STARTED_AT, "review"],
        ATTEMPT_ID,
      ),
    ),
    call("AgentSessionRepository.listRunUsage", (world) =>
      sessions(world).listRunUsage("run-session"),
    ),
    call("AgentSessionRepository.saveTurnUsage", (world) =>
      sessions(world).saveTurnUsage(USAGE),
    ),
    call("AgentSessionRepository.saveTurnUsage", (world) =>
      sessions(world).saveTurnUsage({
        ...USAGE,
        turn: 2,
        inputTokens: null,
        inputIncludesCache: true,
        isPartial: true,
      }),
    ),
    call("AgentSessionRepository.saveTurnUsage", (world) =>
      sessions(world).saveTurnUsage({ ...USAGE, outputTokens: 21 }),
    ),
    reversedInPostgres("agent_session_turn_usage"),
    call("AgentSessionRepository.listRunUsage", (world) =>
      sessions(world).listRunUsage("run-session"),
    ),
    refused("AgentSessionRepository.saveTurnUsage", (world) =>
      sessions(world).saveTurnUsage({
        ...USAGE,
        turn: 9,
        reportedAt: MISSING_TEXT,
      }),
    ),
    call("readUsageRow", async ({ database }) =>
      (
        await database.query(`
          SELECT ${USAGE_COLUMNS}
          FROM agent_session_turn_usage
          WHERE attempt_id = 'attempt-session'
          ORDER BY turn;
        `)
      ).map(readUsageRow),
    ),
    refused("readUsageRow", async () =>
      readUsageRow(["attempt", 1, "unknown"]),
    ),
    call("readAttemptRow", async ({ database }) =>
      (
        await database.query(`
          SELECT ${ATTEMPT_COLUMNS}
          FROM agent_session_attempts
          WHERE attempt_id = 'attempt-session';
        `)
      ).map(readAttemptRow),
    ),
    refused("readAttemptRow", async () => readAttemptRow([])),
    call("AgentSessionRepository.saveMessage", (world) =>
      sessions(world).saveMessage({
        id: "message-b",
        attemptId: ATTEMPT_ID,
        userId: OWNER,
        kind: "instruction",
        text: "Bitte weiter",
        status: "queued",
        createdAt: STARTED_AT,
        updatedAt: STARTED_AT,
      }),
    ),
    call("AgentSessionRepository.saveMessage", (world) =>
      sessions(world).saveMessage({
        id: "message-a",
        attemptId: ATTEMPT_ID,
        userId: OWNER,
        kind: "repair",
        text: "Reparatur",
        status: "delivering",
        createdAt: STARTED_AT,
        updatedAt: STARTED_AT,
      }),
    ),
    reversedInPostgres("agent_session_messages"),
    call("AgentSessionRepository.listMessages", (world) =>
      sessions(world).listMessages(ATTEMPT_ID),
    ),
    call("AgentSessionRepository.updateMessage", (world) =>
      sessions(world).updateMessage("message-b", [], "failed"),
    ),
    call("AgentSessionRepository.updateMessage", (world) =>
      sessions(world).updateMessage("message-b", ["delivered"], "failed"),
    ),
    call("AgentSessionRepository.updateMessage", (world) =>
      sessions(world).updateMessage(
        "message-b",
        ["queued", "delivering"],
        "cancelled",
      ),
    ),
    call("AgentSessionRepository.markUncertainDeliveries", (world) =>
      sessions(world).markUncertainDeliveries(),
    ),
    call("AgentSessionRepository.markUncertainDeliveries", (world) =>
      sessions(world).markUncertainDeliveries(),
    ),
    callAtAnyTime("AgentSessionRepository.listMessages", (world) =>
      sessions(world).listMessages(ATTEMPT_ID),
    ),
    refused("AgentSessionRepository.saveMessage", (world) =>
      sessions(world).saveMessage({
        id: "message-a",
        attemptId: ATTEMPT_ID,
        userId: OWNER,
        kind: "repair",
        text: "Doppelt",
        status: "queued",
        createdAt: STARTED_AT,
        updatedAt: STARTED_AT,
      }),
    ),
    callAtAnyTime("readMessageRow", async ({ database }) =>
      (
        await database.query(`
          SELECT ${MESSAGE_COLUMNS}
          FROM agent_session_messages
          WHERE attempt_id = 'attempt-session'
          ORDER BY created_at, id;
        `)
      ).map(readMessageRow),
    ),
    refused("readMessageRow", async () =>
      readMessageRow([
        "id",
        "attempt",
        "user",
        "instruction",
        "Text",
        "unknown",
      ]),
    ),
  ],
};

/** The outbox of what agents received and answered. */
export const PAGE_AGENT_RUN_FLOW: RepositoryFlow = {
  title: "page agent runs",
  steps: [
    call("PageAgentRunRepository.findInput", (world) =>
      records(world).findInput("plan-run-record", "review"),
    ),
    call("PageAgentRunRepository.pinInput", (world) =>
      records(world).pinInput("plan-run-record", "review", {
        prompt: "Erster Auftrag",
        startedAt: STARTED_AT,
      }),
    ),
    call("PageAgentRunRepository.pinInput", (world) =>
      records(world).pinInput("plan-run-record", "review", {
        prompt: "Zweiter Auftrag",
        startedAt: "2026-03-02T08:00:00.000Z",
      }),
    ),
    call("PageAgentRunRepository.findInput", (world) =>
      records(world).findInput("plan-run-record", "review"),
    ),
    refused("PageAgentRunRepository.pinInput", (world) =>
      records(world).pinInput("plan-run-record", "other", {
        prompt: MISSING_TEXT,
        startedAt: STARTED_AT,
      }),
    ),
    call("PageAgentRunRepository.discardInput", (world) =>
      records(world).discardInput("plan-run-record", "review"),
    ),
    call("PageAgentRunRepository.findInput", (world) =>
      records(world).findInput("plan-run-record", "review"),
    ),
    call("PageAgentRunRepository.find", (world) =>
      records(world).find("agent-record", "run-record"),
    ),
    refused("PageAgentRunRepository.get", (world) =>
      records(world).get("agent-record", "run-record"),
    ),
    call("PageAgentRunRepository.save", (world) =>
      records(world).save(RUN_RECORD),
    ),
    call("PageAgentRunRepository.save", (world) =>
      records(world).save({ ...RUN_RECORD, result: "Später" }),
    ),
    call("PageAgentRunRepository.save", (world) =>
      records(world).save({
        ...RUN_RECORD,
        agentId: "agent-another",
        reasoningEffort: "high",
      }),
    ),
    reversedInPostgres("page_agent_run_records"),
    call("PageAgentRunRepository.get", (world) =>
      records(world).get("agent-another", "run-record"),
    ),
    call("PageAgentRunRepository.keys", async (world) =>
      (await records(world).keys()).filter((key) =>
        key.runId.startsWith("run-record"),
      ),
    ),
    prepare(
      "DELETE FROM page_agent_run_records WHERE agent_id = 'agent-another';",
    ),
    prepare(`
      INSERT INTO agent_plan_runs (id, plan_id, user_id, project_id, workspace_id, started_at, status, view_json, snapshot_json)
      VALUES
          ('run-archive-b', 'plan-archive', 'user-plan-owner', 'p', 'w', '2026-03-01', 'failed', '{"b":1}', '{}'),
          ('run-archive-a', 'plan-archive', 'user-plan-owner', 'p', 'w', '2026-03-01', 'succeeded', 'kein JSON', 'kein JSON'),
          ('run-archive-c', 'plan-archive', 'user-plan-owner', 'p', 'w', '2026-03-01', 'running', '{}', '{}');
    `),
    reversedInPostgres("agent_plan_runs"),
    call("PageAgentRunRepository.unarchived", async (world) =>
      (await records(world).unarchived()).filter((run) =>
        run.id.startsWith("run-archive-"),
      ),
    ),
    call("PageAgentRunRepository.markArchived", (world) =>
      records(world).markArchived("run-archive-a"),
    ),
    call("PageAgentRunRepository.markArchived", (world) =>
      records(world).markArchived("run-archive-a"),
    ),
    call("PageAgentRunRepository.unarchived", async (world) =>
      (await records(world).unarchived()).filter((run) =>
        run.id.startsWith("run-archive-"),
      ),
    ),
    stored(
      "SELECT plan_run_id FROM page_agent_archived_runs WHERE plan_run_id LIKE 'run-archive-%';",
    ),
    prepare("DELETE FROM agent_plan_runs WHERE id LIKE 'run-archive-%';"),
  ],
};
