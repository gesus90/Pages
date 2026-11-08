import { ChatAcpSessionRepository } from "@/backend/database/repositories/chat/ChatAcpSessionRepository";
import { ChatJobRepository } from "@/backend/database/repositories/chat/ChatJobRepository";
import { ChatSettingsRepository } from "@/backend/database/repositories/chat/ChatSettingsRepository";
import { ChatSteerRepository } from "@/backend/database/repositories/chat/ChatSteerRepository";
import { PicaSettingsRepository } from "@/backend/database/repositories/chat/PicaSettingsRepository";

import {
  call,
  MISSING_TEXT,
  prepare,
  refused,
  reversedInPostgres,
  stored,
} from "./world";

import type { RepositoryFlow, RepositoryWorld } from "./world";
import type { ChatAcpSession } from "@/backend/database/repositories/chat/ChatAcpSessionRepository";
import type { ChatJobEvent, ChatJobState } from "@/definition/ChatJob";
import type { PicaSettings } from "@/definition/PicaSettings";

const OWNER = "user-chat-owner";
const STRANGER = "user-chat-stranger";
const SESSION = "chat-jobs";
const OLD_TIME = "2026-02-01 08:00:00";
const MANY_TOKENS = 3_000_000_000;

const ANSWER_EVENT: ChatJobEvent = {
  kind: "end",
  state: "completed",
  errorCode: null,
};

const ACP_SESSION: ChatAcpSession = {
  chatSessionId: SESSION,
  userId: OWNER,
  connectionId: "connection-chat",
  model: "model-a",
  reasoningEffort: null,
  profile: "profile-a",
  acpSessionId: "acp-a",
  throughMessageId: null,
};

const PICA_SETTINGS: PicaSettings = {
  isEnabled: true,
  selection: {
    connectionId: "connection-chat",
    model: "model-a",
    reasoningEffort: null,
  },
  run: {
    access: "workspace_write",
    shell: true,
    web: false,
    timeoutMinutes: 15,
  },
  revision: 1,
};

function jobs({ database }: RepositoryWorld): ChatJobRepository {
  return new ChatJobRepository(database);
}

function steers({ database }: RepositoryWorld): ChatSteerRepository {
  return new ChatSteerRepository(database);
}

function acpSessions({ database }: RepositoryWorld): ChatAcpSessionRepository {
  return new ChatAcpSessionRepository(database);
}

function chatSettings({ database }: RepositoryWorld): ChatSettingsRepository {
  return new ChatSettingsRepository(database);
}

function picaSettings({ database }: RepositoryWorld): PicaSettingsRepository {
  return new PicaSettingsRepository(database);
}

/** Pica jobs: their end, their consumption, their journal and the restart of the server. */
export const CHAT_JOB_FLOW: RepositoryFlow = {
  title: "chat jobs",
  steps: [
    call("ChatJobRepository.latest", (world) =>
      jobs(world).latest(OWNER, SESSION),
    ),
    call("ChatJobRepository.create", (world) =>
      jobs(world).create({
        id: "job-b",
        sessionId: SESSION,
        userId: OWNER,
        messageId: "message-b",
      }),
    ),
    call("ChatJobRepository.create", (world) =>
      jobs(world).create({
        id: "job-a",
        sessionId: SESSION,
        userId: OWNER,
        messageId: "message-a",
      }),
    ),
    refused("ChatJobRepository.create", (world) =>
      jobs(world).create({
        id: "job-a",
        sessionId: SESSION,
        userId: OWNER,
        messageId: "message-again",
      }),
    ),
    prepare(
      `UPDATE chat_jobs SET created_at = '${OLD_TIME}' WHERE session_id = '${SESSION}';`,
    ),
    call("ChatJobRepository.find", (world) => jobs(world).find(OWNER, "job-a")),
    call("ChatJobRepository.find", (world) =>
      jobs(world).find(STRANGER, "job-a"),
    ),
    call("ChatJobRepository.findByMessage", (world) =>
      jobs(world).findByMessage(OWNER, "message-b"),
    ),
    call("ChatJobRepository.findByMessage", (world) =>
      jobs(world).findByMessage(STRANGER, "message-b"),
    ),
    call("ChatJobRepository.latest", (world) =>
      jobs(world).latest(OWNER, SESSION),
    ),
    reversedInPostgres("chat_jobs"),
    call("ChatJobRepository.latest", (world) =>
      jobs(world).latest(OWNER, SESSION),
    ),
    call("ChatJobRepository.latest", (world) =>
      jobs(world).latest(STRANGER, SESSION),
    ),
    call("ChatJobRepository.saveContext", (world) =>
      jobs(world).saveContext(
        "job-a",
        { used: MANY_TOKENS, size: 2 * MANY_TOKENS },
        { amount: 0.1 + 0.2, currency: "USD", isEstimated: true },
      ),
    ),
    call("ChatJobRepository.find", (world) => jobs(world).find(OWNER, "job-a")),
    call("ChatJobRepository.saveContext", (world) =>
      jobs(world).saveContext("job-a", null, {
        amount: 2,
        currency: "EUR",
        isEstimated: false,
        scope: "session",
      }),
    ),
    call("ChatJobRepository.find", (world) => jobs(world).find(OWNER, "job-a")),
    call("ChatJobRepository.saveContext", (world) =>
      jobs(world).saveContext("job-a", { used: 0, size: 100 }, null),
    ),
    call("ChatJobRepository.find", (world) => jobs(world).find(OWNER, "job-a")),
    call("ChatJobRepository.saveTurn", (world) =>
      jobs(world).saveTurn("job-a", 1, {
        input: MANY_TOKENS,
        output: 5,
        total: MANY_TOKENS + 5,
      }),
    ),
    call("ChatJobRepository.saveTurn", (world) =>
      jobs(world).saveTurn("job-a", 2, {
        input: MANY_TOKENS,
        output: 7,
        total: MANY_TOKENS + 7,
      }),
    ),
    call("ChatJobRepository.find", (world) => jobs(world).find(OWNER, "job-a")),
    call("ChatJobRepository.saveTurn", (world) =>
      jobs(world).saveTurn("job-a", 2, { input: 1, output: 1, total: 2 }, true),
    ),
    call("ChatJobRepository.find", (world) => jobs(world).find(OWNER, "job-a")),
    call("ChatJobRepository.saveTurn", (world) =>
      jobs(world).saveTurn("job-a", 2, { input: 1, output: 1, total: 2 }),
    ),
    call("ChatJobRepository.saveTurn", (world) =>
      jobs(world).saveTurn("job-a", 3, null),
    ),
    call("ChatJobRepository.find", (world) => jobs(world).find(OWNER, "job-a")),
    call("ChatJobRepository.saveTurn", (world) =>
      jobs(world).saveTurn("job-b", 1, null),
    ),
    call("ChatJobRepository.find", (world) => jobs(world).find(OWNER, "job-b")),
    refused("ChatJobRepository.saveTurn", (world) =>
      jobs(world).saveTurn(MISSING_TEXT, 1, null),
    ),
    ...[1, 2, 3].map((sequence) =>
      call("ChatJobRepository.append", (world) =>
        jobs(world).append("job-a", sequence, {
          ...ANSWER_EVENT,
          errorCode: `code-${String(sequence)}`,
        }),
      ),
    ),
    refused("ChatJobRepository.append", (world) =>
      jobs(world).append("job-a", 3, ANSWER_EVENT),
    ),
    reversedInPostgres("chat_job_events"),
    call("ChatJobRepository.events", (world) =>
      jobs(world).events(OWNER, "job-a", { after: 0, limit: 10 }),
    ),
    call("ChatJobRepository.events", (world) =>
      jobs(world).events(OWNER, "job-a", { after: 1, limit: 1 }),
    ),
    call("ChatJobRepository.events", (world) =>
      jobs(world).events(STRANGER, "job-a", { after: 0, limit: 10 }),
    ),
    prepare(
      "INSERT INTO chat_job_events (job_id, sequence, payload) VALUES ('job-b', 1, 'kein JSON');",
    ),
    refused("ChatJobRepository.events", (world) =>
      jobs(world).events(OWNER, "job-b", { after: 0, limit: 10 }),
    ),
    prepare("DELETE FROM chat_job_events WHERE job_id = 'job-b';"),
    refused("ChatJobRepository.finish", (world) =>
      jobs(world).finish(
        "job-a",
        "gone" as Exclude<ChatJobState, "running">,
        null,
      ),
    ),
    call("ChatJobRepository.finish", (world) =>
      jobs(world).finish("job-a", "failed", "provider_error"),
    ),
    call("ChatJobRepository.finish", (world) =>
      jobs(world).finish("job-a", "completed", null),
    ),
    call("ChatJobRepository.find", (world) => jobs(world).find(OWNER, "job-a")),
    call("ChatJobRepository.create", (world) =>
      jobs(world).create({
        id: "job-d",
        sessionId: SESSION,
        userId: OWNER,
        messageId: "message-d",
      }),
    ),
    call("ChatJobRepository.create", (world) =>
      jobs(world).create({
        id: "job-c",
        sessionId: SESSION,
        userId: OWNER,
        messageId: "message-c",
      }),
    ),
    call("ChatJobRepository.append", (world) =>
      jobs(world).append("job-c", 4, ANSWER_EVENT),
    ),
    ...[
      ["steer-pending", "pending", null],
      ["steer-delivered", "delivered", null],
      ["steer-accepted", "accepted", null],
      ["steer-open", "followUp", null],
      ["steer-answered", "followUp", "answer-1"],
    ].map(([message, status, answer]) =>
      prepare(
        `
        INSERT INTO chat_steers (message_id, job_id, session_id, status, answer_message_id)
        VALUES ($message, 'job-c', '${SESSION}', $status, CAST($answer AS TEXT));
      `,
        {
          message: message ?? "",
          status: status ?? "",
          answer: answer ?? null,
        },
      ),
    ),
    reversedInPostgres("chat_jobs"),
    call("ChatJobRepository.interruptRunning", (world) =>
      jobs(world).interruptRunning(),
    ),
    call("ChatJobRepository.interruptRunning", (world) =>
      jobs(world).interruptRunning(),
    ),
    call("ChatJobRepository.find", (world) => jobs(world).find(OWNER, "job-c")),
    call("ChatJobRepository.events", (world) =>
      jobs(world).events(OWNER, "job-c", { after: 0, limit: 10 }),
    ),
    call("ChatJobRepository.events", (world) =>
      jobs(world).events(OWNER, "job-d", { after: 0, limit: 10 }),
    ),
    stored(`
      SELECT
          message_id,
          status,
          answer_message_id
      FROM chat_steers
      WHERE job_id = 'job-c'
      ORDER BY message_id;
    `),
  ],
};

/** Messages sent while Pica answers, and the selection snapshot of a message. */
export const CHAT_STEER_FLOW: RepositoryFlow = {
  title: "chat steers",
  steps: [
    call("ChatSteerRepository.list", (world) =>
      steers(world).list("chat-steers"),
    ),
    ...["steer-b", "steer-c", "steer-a"].map((messageId) =>
      call("ChatSteerRepository.create", (world) =>
        steers(world).create({ messageId, jobId: "job-a" }, "chat-steers"),
      ),
    ),
    refused("ChatSteerRepository.create", (world) =>
      steers(world).create(
        { messageId: "steer-a", jobId: "job-b" },
        "chat-steers",
      ),
    ),
    call("ChatSteerRepository.update", (world) =>
      steers(world).update("steer-b", "delivered"),
    ),
    call("ChatSteerRepository.update", (world) =>
      steers(world).update("steer-unknown", "delivered"),
    ),
    refused("ChatSteerRepository.update", (world) =>
      steers(world).update("steer-b", MISSING_TEXT as "pending"),
    ),
    call("ChatSteerRepository.update", (world) =>
      steers(world).update("steer-c", "followUp"),
    ),
    call("ChatSteerRepository.answer", (world) =>
      steers(world).answer("steer-c", "answer-c"),
    ),
    call("ChatSteerRepository.list", (world) =>
      steers(world).list("chat-steers"),
    ),
    reversedInPostgres("chat_steers"),
    call("ChatSteerRepository.list", (world) =>
      steers(world).list("chat-steers"),
    ),
    stored(`
      SELECT
          message_id,
          status,
          answer_message_id
      FROM chat_steers
      WHERE session_id = 'chat-steers'
      ORDER BY message_id;
    `),
    call("ChatSteerRepository.selections", (world) =>
      steers(world).selections("chat-steers"),
    ),
    call("ChatSteerRepository.select", (world) =>
      steers(world).select("chat-steers", {
        messageId: "steer-b",
        items: [
          {
            attachmentId: "attachment-1",
            fileName: "bericht ä.pdf",
            contentType: "application/pdf",
            size: 12,
            transfer: "truncated",
            scope: { characters: 12, pages: { read: 1, total: 2 } },
          },
        ],
      }),
    ),
    call("ChatSteerRepository.select", (world) =>
      steers(world).select("chat-steers", { messageId: "steer-a", items: [] }),
    ),
    refused("ChatSteerRepository.select", (world) =>
      steers(world).select("chat-steers", { messageId: "steer-a", items: [] }),
    ),
    prepare(
      `UPDATE chat_selections SET created_at = '${OLD_TIME}' WHERE session_id = 'chat-steers';`,
    ),
    call("ChatSteerRepository.selections", (world) =>
      steers(world).selections("chat-steers"),
    ),
    reversedInPostgres("chat_selections"),
    call("ChatSteerRepository.selections", (world) =>
      steers(world).selections("chat-steers"),
    ),
  ],
};

/** The agent session that continues a conversation, bound to its owner. */
export const CHAT_ACP_FLOW: RepositoryFlow = {
  title: "chat agent sessions",
  steps: [
    call("ChatAcpSessionRepository.find", (world) =>
      acpSessions(world).find(OWNER, SESSION),
    ),
    call("ChatAcpSessionRepository.save", (world) =>
      acpSessions(world).save(ACP_SESSION),
    ),
    call("ChatAcpSessionRepository.find", (world) =>
      acpSessions(world).find(OWNER, SESSION),
    ),
    call("ChatAcpSessionRepository.find", (world) =>
      acpSessions(world).find(STRANGER, SESSION),
    ),
    call("ChatAcpSessionRepository.save", (world) =>
      acpSessions(world).save({
        ...ACP_SESSION,
        model: "model-b",
        reasoningEffort: "high",
        acpSessionId: "acp-b",
        throughMessageId: "message-a",
      }),
    ),
    call("ChatAcpSessionRepository.find", (world) =>
      acpSessions(world).find(OWNER, SESSION),
    ),
    refused("ChatAcpSessionRepository.save", (world) =>
      acpSessions(world).save({
        ...ACP_SESSION,
        chatSessionId: "chat-no-model",
        model: MISSING_TEXT,
      }),
    ),
    call("ChatAcpSessionRepository.remove", (world) =>
      acpSessions(world).remove(STRANGER, SESSION),
    ),
    call("ChatAcpSessionRepository.find", (world) =>
      acpSessions(world).find(OWNER, SESSION),
    ),
    call("ChatAcpSessionRepository.remove", (world) =>
      acpSessions(world).remove(OWNER, SESSION),
    ),
    call("ChatAcpSessionRepository.find", (world) =>
      acpSessions(world).find(OWNER, SESSION),
    ),
  ],
};

/** The one row of the chat settings, and the fixed identity of Pica. */
export const CHAT_SETTINGS_FLOW: RepositoryFlow = {
  title: "chat settings",
  steps: [
    call("ChatSettingsRepository.read", (world) => chatSettings(world).read()),
    call("ChatSettingsRepository.save", (world) =>
      chatSettings(world).save({ systemInstruction: "Antworte kurz." }),
    ),
    call("ChatSettingsRepository.read", (world) => chatSettings(world).read()),
    prepare("DELETE FROM chat_settings;"),
    call("ChatSettingsRepository.read", (world) => chatSettings(world).read()),
    call("ChatSettingsRepository.save", (world) =>
      chatSettings(world).save({ systemInstruction: null }),
    ),
    call("ChatSettingsRepository.read", (world) => chatSettings(world).read()),
    call("PicaSettingsRepository.read", (world) => picaSettings(world).read()),
    refused("PicaSettingsRepository.save", (world) =>
      picaSettings(world).save({ ...PICA_SETTINGS, revision: 7 }),
    ),
    call("PicaSettingsRepository.read", (world) => picaSettings(world).read()),
    call("PicaSettingsRepository.save", (world) =>
      picaSettings(world).save(PICA_SETTINGS),
    ),
    call("PicaSettingsRepository.read", (world) => picaSettings(world).read()),
    call("PicaSettingsRepository.save", (world) =>
      picaSettings(world).save({
        isEnabled: false,
        selection: null,
        run: null,
        revision: 2,
      }),
    ),
    call("PicaSettingsRepository.read", (world) => picaSettings(world).read()),
    prepare("DELETE FROM pica_settings;"),
    refused("PicaSettingsRepository.read", (world) =>
      picaSettings(world).read(),
    ),
    prepare("INSERT INTO pica_settings (id) VALUES (1);"),
  ],
};
