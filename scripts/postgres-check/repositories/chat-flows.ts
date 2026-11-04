import { ChatAttachmentRepository } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import { ChatContextRepository } from "@/backend/database/repositories/chat/ChatContextRepository";
import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";

import {
  call,
  MISSING_TEXT,
  prepare,
  refused,
  refusedWithoutTable,
  reversedInPostgres,
  stored,
} from "./world";

import type { RepositoryFlow, RepositoryStep, RepositoryWorld } from "./world";
import type { NewChatAttachment } from "@/backend/database/repositories/chat/ChatAttachmentRepository";

const OWNER = "user-chat-owner";
const STRANGER = "user-chat-stranger";
const OLD_TIME = "2026-02-01 08:00:00";
const LATER_TIME = "2026-02-01 09:00:00";
const LONG_MESSAGE = `${"🦊ß".repeat(45)}\n  Ende`;

const UPLOAD: NewChatAttachment = {
  sessionId: "chat-files",
  fileName: "bericht ä.pdf",
  contentType: "application/pdf",
  size: 3_000_000_000,
  storageName: "stored-upload-b",
};

function sessions({ database }: RepositoryWorld): ChatSessionRepository {
  return new ChatSessionRepository(database);
}

function attachments({ database }: RepositoryWorld): ChatAttachmentRepository {
  return new ChatAttachmentRepository(database);
}

function context({ database }: RepositoryWorld): ChatContextRepository {
  return new ChatContextRepository(database);
}

/** The generated identifier of an attachment, found by what the caller chose. */
async function attachmentId(
  { database }: RepositoryWorld,
  storageName: string,
): Promise<string> {
  const [row] = await database.query(
    "SELECT id FROM chat_attachments WHERE storage_name = $storage_name;",
    { storage_name: storageName },
  );
  const id = row?.[0];
  if (typeof id !== "string") throw new Error("The flow ends without the row.");
  return id;
}

/** The clock decides the sort keys of new rows, so a flow pins them before it reads a list. */
function sessionsAt(time: string): RepositoryStep {
  return prepare(
    `
    UPDATE chat_sessions
    SET last_message_at = $time,
        created_at = $time
    WHERE user_id = '${OWNER}';
  `,
    { time },
  );
}

function attachmentsInStorageOrder(): RepositoryStep {
  return prepare(
    `
    UPDATE chat_attachments
    SET created_at = '${OLD_TIME}'
    WHERE session_id LIKE 'chat-%';
  `,
  );
}

/** Pica sessions: owned conversations, their messages and the removal of everything in them. */
export const CHAT_SESSION_FLOW: RepositoryFlow = {
  title: "chat sessions",
  steps: [
    call("ChatSessionRepository.exists", (world) =>
      sessions(world).exists("chat-b"),
    ),
    call("ChatSessionRepository.list", (world) => sessions(world).list(OWNER)),
    call("ChatSessionRepository.create", (world) =>
      sessions(world).create(OWNER, "chat-b"),
    ),
    call("ChatSessionRepository.create", (world) =>
      sessions(world).create(OWNER, "chat-a"),
    ),
    call("ChatSessionRepository.create", (world) =>
      sessions(world).create(OWNER, "chat-c"),
    ),
    refused("ChatSessionRepository.create", (world) =>
      sessions(world).create(STRANGER, "chat-b"),
    ),
    refused("ChatSessionRepository.create", (world) =>
      sessions(world).create(MISSING_TEXT, "chat-no-owner"),
    ),
    call("ChatSessionRepository.exists", (world) =>
      sessions(world).exists("chat-b"),
    ),
    call("ChatSessionRepository.find", (world) =>
      sessions(world).find(OWNER, "chat-b"),
    ),
    call("ChatSessionRepository.find", (world) =>
      sessions(world).find(STRANGER, "chat-b"),
    ),
    call("ChatSessionRepository.messages", (world) =>
      sessions(world).messages("chat-b"),
    ),
    call("ChatSessionRepository.append", (world) =>
      sessions(world).append(OWNER, "chat-b", {
        role: "assistant",
        content: "Antwort vor der Frage",
      }),
    ),
    call("ChatSessionRepository.append", (world) =>
      sessions(world).append(OWNER, "chat-b", {
        role: "user",
        content: LONG_MESSAGE,
        clientMessageId: "client-1",
      }),
    ),
    call("ChatSessionRepository.append", (world) =>
      sessions(world).append(OWNER, "chat-b", {
        role: "assistant",
        content: "Gestoppt",
        isStopped: true,
      }),
    ),
    call("ChatSessionRepository.append", (world) =>
      sessions(world).append(OWNER, "chat-b", {
        role: "user",
        content: "  zweite\tFrage  ",
        clientMessageId: "client-2",
        isStopped: false,
      }),
    ),
    call("ChatSessionRepository.append", (world) =>
      sessions(world).append(OWNER, "chat-a", {
        role: "user",
        content: "Andere Sitzung",
        clientMessageId: "client-1",
      }),
    ),
    sessionsAt(OLD_TIME),
    refused("ChatSessionRepository.append", (world) =>
      sessions(world).append(OWNER, "chat-b", {
        role: "user",
        content: "Zum zweiten Mal gesendet",
        clientMessageId: "client-1",
      }),
    ),
    refused("ChatSessionRepository.append", (world) =>
      sessions(world).append(STRANGER, "chat-b", {
        role: "user",
        content: "Fremd",
      }),
    ),
    refused("ChatSessionRepository.append", (world) =>
      sessions(world).append(OWNER, "chat-unknown", {
        role: "user",
        content: "Weg",
      }),
    ),
    refused("ChatSessionRepository.append", (world) =>
      sessions(world).append(OWNER, "chat-b", {
        role: "user",
        content: MISSING_TEXT,
      }),
    ),
    stored(
      `
      SELECT
          id,
          last_message_at = '${OLD_TIME}',
          created_at = '${OLD_TIME}'
      FROM chat_sessions
      WHERE user_id = '${OWNER}'
      ORDER BY id;
    `,
    ),
    call("ChatSessionRepository.findByClientId", (world) =>
      sessions(world).findByClientId("chat-b", "client-2"),
    ),
    call("ChatSessionRepository.findByClientId", (world) =>
      sessions(world).findByClientId("chat-c", "client-2"),
    ),
    call("ChatSessionRepository.messages", (world) =>
      sessions(world).messages("chat-b"),
    ),
    reversedInPostgres("chat_messages"),
    call("ChatSessionRepository.messages", (world) =>
      sessions(world).messages("chat-b"),
    ),
    prepare(`
      INSERT INTO chat_messages (id, session_id, position, role, content)
      VALUES
          ('tie-b', 'chat-c', 1, 'user', 'Gleiche Stelle b'),
          ('tie-a', 'chat-c', 1, 'user', 'Gleiche Stelle a');
    `),
    call("ChatSessionRepository.messages", async (world) =>
      (await sessions(world).messages("chat-c")).map((entry) => entry.content),
    ),
    call("ChatSessionRepository.find", (world) =>
      sessions(world).find(OWNER, "chat-c"),
    ),
    reversedInPostgres("chat_messages"),
    call("ChatSessionRepository.messages", async (world) =>
      (await sessions(world).messages("chat-c")).map((entry) => entry.content),
    ),
    call("ChatSessionRepository.find", (world) =>
      sessions(world).find(OWNER, "chat-c"),
    ),
    call("ChatSessionRepository.list", (world) => sessions(world).list(OWNER)),
    reversedInPostgres("chat_sessions"),
    call("ChatSessionRepository.list", (world) => sessions(world).list(OWNER)),
    call("ChatSessionRepository.list", (world) =>
      sessions(world).list(OWNER, 2),
    ),
    prepare(
      `UPDATE chat_sessions SET last_message_at = '${LATER_TIME}' WHERE id = 'chat-c';`,
    ),
    prepare(
      `UPDATE chat_sessions SET created_at = '${LATER_TIME}' WHERE id = 'chat-b';`,
    ),
    call("ChatSessionRepository.list", (world) => sessions(world).list(OWNER)),
    call("ChatSessionRepository.list", (world) =>
      sessions(world).list(STRANGER, 5),
    ),
    prepare(`
      INSERT INTO chat_attachments (id, session_id, file_name, content_type, size, storage_name, origin)
      VALUES
          ('removal-b', 'chat-c', 'b.txt', 'text/plain', 1, 'removed-b', 'user'),
          ('removal-a', 'chat-c', 'a.txt', 'text/plain', 1, 'removed-a', 'user');
    `),
    prepare(`
      INSERT INTO chat_jobs (id, session_id, user_id, message_id, state)
      VALUES ('removal-job', 'chat-c', '${OWNER}', 'tie-a', 'completed');
    `),
    prepare(
      "INSERT INTO chat_job_events (job_id, sequence, payload) VALUES ('removal-job', 1, '{}');",
    ),
    prepare(
      "INSERT INTO chat_job_turns (job_id, turn) VALUES ('removal-job', 1);",
    ),
    prepare(`
      INSERT INTO chat_steers (message_id, job_id, session_id, status)
      VALUES ('tie-b', 'removal-job', 'chat-c', 'pending');
    `),
    prepare(`
      INSERT INTO chat_selections (message_id, session_id, items)
      VALUES ('tie-b', 'chat-c', '[]');
    `),
    prepare(`
      INSERT INTO chat_acp_sessions (
          chat_session_id, user_id, connection_id, model, profile, acp_session_id
      )
      VALUES ('chat-c', '${OWNER}', 'connection', 'model', 'profile', 'acp');
    `),
    call("ChatSessionRepository.remove", (world) =>
      sessions(world).remove(STRANGER, "chat-c"),
    ),
    reversedInPostgres("chat_attachments"),
    call("ChatSessionRepository.remove", (world) =>
      sessions(world).remove(OWNER, "chat-c"),
    ),
    call("ChatSessionRepository.remove", (world) =>
      sessions(world).remove(OWNER, "chat-c"),
    ),
    refusedWithoutTable(
      "ChatSessionRepository.remove",
      "chat_job_turns",
      (transaction) =>
        new ChatSessionRepository({
          ...transaction,
          transaction: (work) => work(transaction),
        }).remove(OWNER, "chat-a"),
    ),
    stored(`
      SELECT
          (SELECT COUNT(*) FROM chat_sessions WHERE id = 'chat-c'),
          (SELECT COUNT(*) FROM chat_messages WHERE session_id = 'chat-c'),
          (SELECT COUNT(*) FROM chat_attachments WHERE session_id = 'chat-c'),
          (SELECT COUNT(*) FROM chat_jobs WHERE session_id = 'chat-c'),
          (SELECT COUNT(*) FROM chat_job_events WHERE job_id = 'removal-job'),
          (SELECT COUNT(*) FROM chat_job_turns WHERE job_id = 'removal-job'),
          (SELECT COUNT(*) FROM chat_steers WHERE session_id = 'chat-c'),
          (SELECT COUNT(*) FROM chat_selections WHERE session_id = 'chat-c'),
          (SELECT COUNT(*) FROM chat_acp_sessions WHERE chat_session_id = 'chat-c'),
          (SELECT COUNT(*) FROM chat_messages WHERE session_id = 'chat-a');
    `),
  ],
};

/** Uploads and the files of Pica's answers, bound to the owner of the session. */
export const CHAT_ATTACHMENT_FLOW: RepositoryFlow = {
  title: "chat attachments",
  steps: [
    call("ChatSessionRepository.create", (world) =>
      sessions(world).create(OWNER, "chat-files"),
    ),
    call("ChatAttachmentRepository.insertUpload", (world) =>
      attachments(world).insertUpload(OWNER, UPLOAD, 2),
    ),
    call("ChatAttachmentRepository.insertUpload", (world) =>
      attachments(world).insertUpload(
        OWNER,
        { ...UPLOAD, fileName: "a.txt", storageName: "stored-upload-a" },
        2,
      ),
    ),
    call("ChatAttachmentRepository.insertUpload", (world) =>
      attachments(world).insertUpload(
        OWNER,
        { ...UPLOAD, storageName: "stored-upload-full" },
        2,
      ),
    ),
    call("ChatAttachmentRepository.insertUpload", (world) =>
      attachments(world).insertUpload(
        STRANGER,
        { ...UPLOAD, storageName: "stored-upload-foreign" },
        2,
      ),
    ),
    call("ChatAttachmentRepository.insertUpload", (world) =>
      attachments(world).insertUpload(
        OWNER,
        { ...UPLOAD, sessionId: "chat-unknown", storageName: "stored-none" },
        2,
      ),
    ),
    refused("ChatAttachmentRepository.insertUpload", (world) =>
      attachments(world).insertUpload(
        OWNER,
        { ...UPLOAD, fileName: MISSING_TEXT },
        5,
      ),
    ),
    call("ChatAttachmentRepository.insertAnswerFile", (world) =>
      attachments(world).insertAnswerFile(OWNER, {
        ...UPLOAD,
        fileName: "gleich.txt",
        storageName: "stored-answer-b",
        runId: "run-1",
      }),
    ),
    call("ChatAttachmentRepository.insertAnswerFile", (world) =>
      attachments(world).insertAnswerFile(OWNER, {
        ...UPLOAD,
        fileName: "gleich.txt",
        storageName: "stored-answer-a",
        runId: "run-1",
      }),
    ),
    call("ChatAttachmentRepository.insertAnswerFile", (world) =>
      attachments(world).insertAnswerFile(OWNER, {
        ...UPLOAD,
        fileName: "ändern.txt",
        storageName: "stored-answer-c",
        runId: "run-1",
      }),
    ),
    call("ChatAttachmentRepository.insertAnswerFile", (world) =>
      attachments(world).insertAnswerFile(STRANGER, {
        ...UPLOAD,
        storageName: "stored-answer-foreign",
        runId: "run-1",
      }),
    ),
    refused("ChatAttachmentRepository.insertAnswerFile", (world) =>
      attachments(world).insertAnswerFile(OWNER, {
        ...UPLOAD,
        contentType: MISSING_TEXT,
        runId: "run-1",
      }),
    ),
    attachmentsInStorageOrder(),
    prepare(
      `UPDATE chat_attachments SET id = storage_name WHERE session_id = 'chat-files';`,
    ),
    call("ChatAttachmentRepository.list", (world) =>
      attachments(world).list("chat-files"),
    ),
    call("ChatAttachmentRepository.answerFiles", (world) =>
      attachments(world).answerFiles("chat-files", "run-1"),
    ),
    call("ChatAttachmentRepository.answerFiles", (world) =>
      attachments(world).answerFiles("chat-files", "run-unknown"),
    ),
    reversedInPostgres("chat_attachments"),
    call("ChatAttachmentRepository.list", (world) =>
      attachments(world).list("chat-files"),
    ),
    call("ChatAttachmentRepository.answerFiles", (world) =>
      attachments(world).answerFiles("chat-files", "run-1"),
    ),
    call("ChatAttachmentRepository.find", async (world) =>
      attachments(world).find(
        OWNER,
        await attachmentId(world, "stored-upload-a"),
      ),
    ),
    call("ChatAttachmentRepository.find", async (world) =>
      attachments(world).find(
        STRANGER,
        await attachmentId(world, "stored-upload-a"),
      ),
    ),
    call("ChatAttachmentRepository.find", (world) =>
      attachments(world).find(OWNER, "attachment-unknown"),
    ),
    call("ChatAttachmentRepository.claimAnswerFiles", (world) =>
      attachments(world).claimAnswerFiles("chat-files", "run-1", "message-1"),
    ),
    call("ChatAttachmentRepository.claimAnswerFiles", (world) =>
      attachments(world).claimAnswerFiles("chat-files", "run-1", "message-2"),
    ),
    call("ChatAttachmentRepository.answerFiles", (world) =>
      attachments(world).answerFiles("chat-files", "run-1"),
    ),
    call("ChatAttachmentRepository.link", async (world) =>
      attachments(world).link("chat-files", "message-3", [
        await attachmentId(world, "stored-upload-a"),
        await attachmentId(world, "stored-answer-a"),
        "attachment-unknown",
      ]),
    ),
    call("ChatAttachmentRepository.list", (world) =>
      attachments(world).list("chat-files"),
    ),
    call("ChatAttachmentRepository.removeUnsent", async (world) =>
      attachments(world).removeUnsent(
        STRANGER,
        await attachmentId(world, "stored-upload-b"),
      ),
    ),
    call("ChatAttachmentRepository.removeUnsent", async (world) =>
      attachments(world).removeUnsent(
        OWNER,
        await attachmentId(world, "stored-upload-a"),
      ),
    ),
    call("ChatAttachmentRepository.removeUnsent", async (world) =>
      attachments(world).removeUnsent(
        OWNER,
        await attachmentId(world, "stored-upload-b"),
      ),
    ),
    call("ChatAttachmentRepository.removeUnsent", async (world) =>
      attachments(world).removeUnsent(
        OWNER,
        await attachmentId(world, "stored-answer-b"),
      ),
    ),
    ...["c", "a", "d", "b", "e"].map((letter, index) =>
      call("ChatAttachmentRepository.insertAnswerFile", (world) =>
        attachments(world).insertAnswerFile(OWNER, {
          ...UPLOAD,
          sessionId: index === 4 ? "chat-a" : "chat-files",
          storageName: `unclaimed-${letter}`,
          runId: index === 3 ? "run-3" : "run-2",
        }),
      ),
    ),
    attachmentsInStorageOrder(),
    reversedInPostgres("chat_attachments"),
    call("ChatAttachmentRepository.removeUnclaimedAnswerFiles", (world) =>
      attachments(world).removeUnclaimedAnswerFiles("chat-unknown", "run-2"),
    ),
    call("ChatAttachmentRepository.removeUnclaimedAnswerFiles", (world) =>
      attachments(world).removeUnclaimedAnswerFiles("chat-a", null),
    ),
    call("ChatAttachmentRepository.removeUnclaimedAnswerFiles", (world) =>
      attachments(world).removeUnclaimedAnswerFiles(null, "run-3"),
    ),
    call("ChatAttachmentRepository.insertAnswerFile", (world) =>
      attachments(world).insertAnswerFile(OWNER, {
        ...UPLOAD,
        storageName: "unclaimed-f",
        runId: "run-4",
      }),
    ),
    call("ChatAttachmentRepository.removeUnclaimedAnswerFiles", (world) =>
      attachments(world).removeUnclaimedAnswerFiles("chat-files", "run-2"),
    ),
    call("ChatAttachmentRepository.removeUnclaimedAnswerFiles", (world) =>
      attachments(world).removeUnclaimedAnswerFiles(null, null),
    ),
    call("ChatAttachmentRepository.list", (world) =>
      attachments(world).list("chat-files"),
    ),
  ],
};

/** The summary of a conversation, replaced only while nothing changed. */
export const CHAT_CONTEXT_FLOW: RepositoryFlow = {
  title: "chat context",
  steps: [
    call("ChatSessionRepository.create", (world) =>
      sessions(world).create(OWNER, "chat-context"),
    ),
    prepare(`
      INSERT INTO chat_messages (id, session_id, position, role, content)
      VALUES
          ('context-first', 'chat-context', 1, 'user', 'Eins'),
          ('context-tie-b', 'chat-context', 2, 'user', 'Zwei'),
          ('context-tie-a', 'chat-context', 2, 'user', 'Drei');
    `),
    call("ChatContextRepository.read", (world) =>
      context(world).read(OWNER, "chat-context"),
    ),
    call("ChatContextRepository.read", (world) =>
      context(world).read(STRANGER, "chat-context"),
    ),
    call("ChatContextRepository.save", (world) =>
      context(world).save(STRANGER, "chat-context", {
        summary: "Fremd",
        throughId: "context-first",
        expectedRevision: 0,
        latestId: "context-tie-b",
      }),
    ),
    call("ChatContextRepository.save", (world) =>
      context(world).save(OWNER, "chat-context", {
        summary: "Veraltet",
        throughId: "context-first",
        expectedRevision: 0,
        latestId: "context-first",
      }),
    ),
    call("ChatContextRepository.save", (world) =>
      context(world).save(OWNER, "chat-context", {
        summary: "Falsche Revision",
        throughId: "context-first",
        expectedRevision: 7,
        latestId: "context-tie-b",
      }),
    ),
    call("ChatContextRepository.save", (world) =>
      context(world).save(OWNER, "chat-context", {
        summary: "Zusammenfassung ä",
        throughId: "context-first",
        expectedRevision: 0,
        latestId: "context-tie-b",
      }),
    ),
    reversedInPostgres("chat_messages"),
    call("ChatContextRepository.save", (world) =>
      context(world).save(OWNER, "chat-context", {
        summary: "Zweite Zusammenfassung",
        throughId: "context-tie-a",
        expectedRevision: 1,
        latestId: "context-tie-b",
      }),
    ),
    call("ChatContextRepository.read", (world) =>
      context(world).read(OWNER, "chat-context"),
    ),
    call("ChatContextRepository.save", (world) =>
      context(world).save(OWNER, "chat-unknown", {
        summary: "Weg",
        throughId: "context-first",
        expectedRevision: 0,
        latestId: "context-first",
      }),
    ),
    refusedWithoutTable(
      "ChatContextRepository.read",
      "chat_sessions",
      (transaction) =>
        new ChatContextRepository(transaction).read(OWNER, "chat-context"),
    ),
    refusedWithoutTable(
      "ChatContextRepository.save",
      "chat_messages",
      (transaction) =>
        new ChatContextRepository(transaction).save(OWNER, "chat-context", {
          summary: "Ohne Nachrichten",
          throughId: "context-first",
          expectedRevision: 2,
          latestId: "context-first",
        }),
    ),
  ],
};
