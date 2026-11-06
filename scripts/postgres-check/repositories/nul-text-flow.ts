import { ChatAttachmentRepository } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import { ChatContextRepository } from "@/backend/database/repositories/chat/ChatContextRepository";
import { ChatJobRepository } from "@/backend/database/repositories/chat/ChatJobRepository";
import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import { ChatSettingsRepository } from "@/backend/database/repositories/chat/ChatSettingsRepository";
import { DiscordConnectionRepository } from "@/backend/database/repositories/discord/DiscordConnectionRepository";
import { DiscordDeliveryRepository } from "@/backend/database/repositories/discord/DiscordDeliveryRepository";
import { PairingRepository } from "@/backend/database/repositories/mcp/PairingRepository";
import { PersonalAgentTokenRepository } from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";
import { DEFAULT_DISCORD_EVENTS } from "@/definition/Discord";

import { call, prepare, stored } from "./world";

import type { RepositoryFlow, RepositoryStep } from "./world";

const OWNER = "user-nul-owner";
const SESSION = "chat-nul";
const NOW = "2026-03-01T08:00:00.000Z";
const TEXT = "a\u0000b\u0000";
const NUL = "\u0000";

/** The one approved difference, taken out so that every other one still shows. */
function withoutNul(input: unknown): unknown {
  if (typeof input === "string") return input.replaceAll(NUL, "");
  if (Array.isArray(input)) return input.map(withoutNul);
  if (typeof input === "object" && input !== null)
    return Object.fromEntries(
      Object.entries(input).map(([key, item]) => [key, withoutNul(item)]),
    );
  return input;
}

/** Checks that a saved row exists and PostgreSQL removed the NUL character. */
export function keptOnlyByDuckdb(statement: string): RepositoryStep {
  return call("stored", async ({ database }) => {
    const rows = await database.query(statement);
    const values = rows.flat();
    const isStored = values.some(
      (item) => typeof item === "string" && item.includes(NUL),
    );
    return {
      rows: values.length,
      isAsApproved: values.length > 0 && !isStored,
    };
  });
}

/** Every text from the measurement of U+0000: stored by both, without it on PostgreSQL. */
export const NUL_TEXT_FLOW: RepositoryFlow = {
  title: "U+0000 in text",
  steps: [
    call("ChatSessionRepository.create", ({ database }) =>
      new ChatSessionRepository(database).create(OWNER, SESSION),
    ),
    // The answer of Pica takes the same path as a message of a person.
    call("ChatSessionRepository.append", async ({ database }) =>
      withoutNul(
        await new ChatSessionRepository(database).append(OWNER, SESSION, {
          role: "assistant",
          content: TEXT,
        }),
      ),
    ),
    call("ChatSessionRepository.append", async ({ database }) =>
      withoutNul(
        await new ChatSessionRepository(database).append(OWNER, SESSION, {
          role: "user",
          content: TEXT,
        }),
      ),
    ),
    call("ChatSessionRepository.messages", async ({ database }) =>
      withoutNul(await new ChatSessionRepository(database).messages(SESSION)),
    ),
    call("ChatSessionRepository.find", async ({ database }) =>
      withoutNul(
        await new ChatSessionRepository(database).find(OWNER, SESSION),
      ),
    ),
    keptOnlyByDuckdb(
      `SELECT content FROM chat_messages WHERE session_id = '${SESSION}';`,
    ),
    call("ChatAttachmentRepository.insertUpload", async ({ database }) =>
      withoutNul(
        await new ChatAttachmentRepository(database).insertUpload(
          OWNER,
          {
            sessionId: SESSION,
            fileName: TEXT,
            contentType: "text/plain",
            size: 1,
            storageName: "stored-nul",
          },
          5,
        ),
      ),
    ),
    keptOnlyByDuckdb(
      `SELECT file_name FROM chat_attachments WHERE session_id = '${SESSION}';`,
    ),
    prepare(`
      UPDATE chat_messages
      SET id = 'message-nul'
      WHERE session_id = '${SESSION}'
          AND role = 'user';
    `),
    call("ChatContextRepository.save", ({ database }) =>
      new ChatContextRepository(database).save(OWNER, SESSION, {
        summary: TEXT,
        throughId: "message-nul",
        expectedRevision: 0,
        latestId: "message-nul",
      }),
    ),
    call("ChatContextRepository.read", async ({ database }) =>
      withoutNul(
        await new ChatContextRepository(database).read(OWNER, SESSION),
      ),
    ),
    keptOnlyByDuckdb(
      `SELECT context_summary FROM chat_sessions WHERE id = '${SESSION}';`,
    ),
    call("ChatSettingsRepository.save", ({ database }) =>
      new ChatSettingsRepository(database).save({
        attachmentLimitBytes: 16_777_216,
        systemInstruction: TEXT,
      }),
    ),
    call("ChatSettingsRepository.read", async ({ database }) =>
      withoutNul(await new ChatSettingsRepository(database).read()),
    ),
    keptOnlyByDuckdb("SELECT system_instruction FROM chat_settings;"),
    call("ChatSettingsRepository.save", ({ database }) =>
      new ChatSettingsRepository(database).save({
        attachmentLimitBytes: 16_777_216,
        systemInstruction: null,
      }),
    ),
    // A JSON text holds the escape, so both keep it and the event reads as it was.
    call("ChatJobRepository.create", ({ database }) =>
      new ChatJobRepository(database).create({
        id: "job-nul",
        sessionId: SESSION,
        userId: OWNER,
        messageId: "message-nul",
      }),
    ),
    call("ChatJobRepository.append", ({ database }) =>
      new ChatJobRepository(database).append("job-nul", 1, {
        kind: "end",
        state: "failed",
        errorCode: TEXT,
      }),
    ),
    call("ChatJobRepository.events", ({ database }) =>
      new ChatJobRepository(database).events(OWNER, "job-nul", {
        after: 0,
        limit: 5,
      }),
    ),
    stored(
      "SELECT payload FROM chat_job_events WHERE job_id = 'job-nul' ORDER BY sequence;",
    ),
    prepare(`
      UPDATE chat_jobs
      SET state = 'failed'
      WHERE id = 'job-nul';
    `),
    call("DiscordConnectionRepository.saveConnection", ({ database }) =>
      new DiscordConnectionRepository(database).saveConnection({
        projectId: "project-nul",
        guildId: "guild-nul",
        guildName: TEXT,
        channelId: "channel-nul",
        channelName: "kanal",
        baseUrl: "https://pages.example",
        events: DEFAULT_DISCORD_EVENTS,
        connectedBy: OWNER,
        now: NOW,
      }),
    ),
    call("DiscordConnectionRepository.findConnection", async ({ database }) =>
      withoutNul(
        await new DiscordConnectionRepository(database).findConnection(
          "project-nul",
        ),
      ),
    ),
    keptOnlyByDuckdb(
      "SELECT guild_name FROM project_discord_connections WHERE project_id = 'project-nul';",
    ),
    call("DiscordDeliveryRepository.enqueueDelivery", ({ database }) =>
      new DiscordDeliveryRepository(database).enqueueDelivery({
        id: "delivery-nul",
        projectId: "project-nul",
        eventType: "ticket.created",
        subjectKey: "/tasks/PAGE-NUL",
        contentJson: JSON.stringify({ title: TEXT }),
        now: NOW,
      }),
    ),
    stored(
      "SELECT content_json FROM discord_deliveries WHERE id = 'delivery-nul';",
    ),
    prepare("DELETE FROM discord_deliveries WHERE id = 'delivery-nul';"),
    call("PairingRepository.insert", ({ database }) =>
      new PairingRepository(database).insert({
        id: "pairing-nul",
        codeHash: "code-nul",
        secretHash: "secret-nul",
        clientName: TEXT,
        device: "Gerät",
        packageVersion: "1",
        createdAt: 1,
        expiresAt: 2,
        status: "pending",
        userId: null,
        decidedAt: null,
        name: null,
        validitySeconds: null,
        csrfHash: null,
        lastPollAt: null,
        pollInterval: 5,
      }),
    ),
    call("PairingRepository.find", async ({ database }) =>
      withoutNul(await new PairingRepository(database).find("code-nul")),
    ),
    keptOnlyByDuckdb(
      "SELECT client_name FROM mcp_pairing_requests WHERE id = 'pairing-nul';",
    ),
    prepare("DELETE FROM mcp_pairing_requests WHERE id = 'pairing-nul';"),
    call("PersonalAgentTokenRepository.insert", ({ database }) =>
      new PersonalAgentTokenRepository(database).insert(
        {
          id: "token-nul",
          userId: OWNER,
          name: TEXT,
          createdAt: 1,
          expiresAt: null,
          revokedAt: null,
          source: "manual",
          device: null,
          lastUsedAt: null,
          rotatedAt: null,
          rotationRequestedAt: null,
        },
        "hash-nul",
      ),
    ),
    call("PersonalAgentTokenRepository.list", async ({ database }) =>
      withoutNul(await new PersonalAgentTokenRepository(database).list(OWNER)),
    ),
    keptOnlyByDuckdb(
      "SELECT name FROM personal_agent_tokens WHERE id = 'token-nul';",
    ),
    prepare("DELETE FROM personal_agent_tokens WHERE id = 'token-nul';"),
    call("ChatSessionRepository.remove", ({ database }) =>
      new ChatSessionRepository(database).remove(OWNER, SESSION),
    ),
    prepare(
      "DELETE FROM project_discord_connections WHERE project_id = 'project-nul';",
    ),
  ],
};
