import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { ChatAttachmentRepository } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { ChatError } from "@/backend/error/ChatErrors";
import { ChatSessionService } from "@/backend/service/chat/ChatSessionService";
import {
  CHAT_SESSION_WORDS,
  createChatSessionId,
} from "@/backend/service/chat/ChatSessionWords";
import { CHAT_SESSION_ID_PATTERN, readChatCommand } from "@/definition/Chat";

import { useChatHarness } from "../helpers/chat-harness";

import type { ChatHarness } from "../helpers/chat-harness";

const setup = useChatHarness();

async function attach(
  run: ChatHarness,
  sessionId: string,
  name = "notes.txt",
): Promise<string> {
  const attachment = await run.chatAttachmentService.upload(
    run.people.writer,
    sessionId,
    {
      fileName: name,
      contentLength: null,
      body: Readable.from([Buffer.from("Meeting notes")]),
    },
  );
  return attachment.id;
}

describe("A11.4 AK-02: chat sessions and commands", () => {
  it("names sessions with five words from the fixed list and keeps IDs unique", async () => {
    expect(new Set(CHAT_SESSION_WORDS).size).toBe(CHAT_SESSION_WORDS.length);
    expect(CHAT_SESSION_WORDS.length).toBeGreaterThanOrEqual(256);
    for (const word of CHAT_SESSION_WORDS)
      expect(word).toMatch(/^[a-z]{2,12}$/u);
    const drawn = createChatSessionId();
    expect(drawn).toMatch(CHAT_SESSION_ID_PATTERN);
    expect(
      drawn.split("-").every((word) => CHAT_SESSION_WORDS.includes(word)),
    ).toBe(true);
    expect(createChatSessionId(() => 0)).toBe(
      Array(5).fill(CHAT_SESSION_WORDS[0]).join("-"),
    );

    const run = await setup();
    const taken = "haus-baum-zelt-rabe-mond";
    const fresh = "boot-dach-eule-fass-gold";
    const ids = [taken, taken, fresh];
    const sessions = new ChatSessionService({
      sessions: new ChatSessionRepository(run.database),
      attachments: new ChatAttachmentRepository(run.database),
      settings: run.chatSettingsService,
      languages: new UserSettingsRepository(run.database),
      files: { remove: async () => undefined },
      createId: () => ids.shift() ?? fresh,
    });
    expect((await sessions.create(run.people.writer)).session.id).toBe(taken);
    // The second draw collides with the existing session of another person.
    expect((await sessions.create(run.people.reader)).session.id).toBe(fresh);
    const exhausted = new ChatSessionService({
      sessions: new ChatSessionRepository(run.database),
      attachments: new ChatAttachmentRepository(run.database),
      settings: run.chatSettingsService,
      languages: new UserSettingsRepository(run.database),
      files: { remove: async () => undefined },
      createId: () => taken,
    });
    await expect(exhausted.create(run.people.writer)).rejects.toThrow(
      "No unused chat session ID",
    );
  });

  it("opens the latest own session, /new starts another and /sessions lists only own sessions", async () => {
    const run = await setup();
    const sessions = run.chatSessionService;
    const first = await sessions.open(run.people.writer);
    expect(first.session.id).toMatch(CHAT_SESSION_ID_PATTERN);
    expect(first).toMatchObject({
      messages: [],
      pending: [],
      attachmentLimitBytes: 16 * 1024 * 1024,
      confirmationWord: "LÖSCHEN",
    });
    expect((await sessions.open(run.people.writer)).session.id).toBe(
      first.session.id,
    );
    expect(readChatCommand(" /NEW ")).toBe("/new");
    expect(readChatCommand("/new please")).toBeNull();
    const second = await sessions.create(run.people.writer);
    expect(second.session.id).not.toBe(first.session.id);
    const foreign = await sessions.open(run.people.reader);

    const listed = await sessions.list(run.people.writer);
    expect(listed.map(({ id }) => id).sort()).toEqual(
      [first.session.id, second.session.id].sort(),
    );
    expect(listed.map(({ id }) => id)).not.toContain(foreign.session.id);
    await expect(
      sessions.view(run.people.writer, foreign.session.id),
    ).rejects.toMatchObject({ code: "sessionMissing" });
    await expect(sessions.view(run.people.writer, "../etc")).rejects.toThrow(
      ChatError,
    );
  });

  it("/delete deletes an own session only after the typed confirmation, for good and with its attachments", async () => {
    const run = await setup();
    const sessions = run.chatSessionService;
    const { session } = await sessions.open(run.people.writer);
    await attach(run, session.id);
    const files = path.join(run.directory, "chat-attachments");
    expect(readdirSync(files)).toHaveLength(1);

    for (const confirmation of [undefined, "löschen", "DELETE", "JA"])
      await expect(
        sessions.remove(run.people.writer, session.id, confirmation),
      ).rejects.toMatchObject({ code: "confirmationRequired" });
    await expect(
      sessions.remove(run.people.reader, session.id, "LÖSCHEN"),
    ).rejects.toMatchObject({ code: "sessionMissing" });
    expect(
      (await sessions.view(run.people.writer, session.id)).pending,
    ).toHaveLength(1);

    await sessions.remove(run.people.writer, session.id, "LÖSCHEN");
    await expect(
      sessions.view(run.people.writer, session.id),
    ).rejects.toMatchObject({ code: "sessionMissing" });
    expect(await sessions.list(run.people.writer)).toEqual([]);
    expect(readdirSync(files)).toHaveLength(0);
    const rows = await run.database.query(
      "SELECT (SELECT COUNT(*) FROM chat_messages) + (SELECT COUNT(*) FROM chat_attachments) + (SELECT COUNT(*) FROM chat_sessions WHERE id = $id);",
      { id: session.id },
    );
    expect(Number(rows[0][0])).toBe(0);
    expect(existsSync(files)).toBe(true);
  });

  it("asks for DELETE in the English interface and refuses inactive accounts", async () => {
    const run = await setup();
    await new UserSettingsRepository(run.database).upsertLanguage(
      run.people.writer.id,
      "en",
    );
    const { session, confirmationWord } = await run.chatSessionService.open(
      run.people.writer,
    );
    expect(confirmationWord).toBe("DELETE");
    await expect(
      run.chatSessionService.remove(run.people.writer, session.id, "LÖSCHEN"),
    ).rejects.toMatchObject({ code: "confirmationRequired" });
    await run.chatSessionService.remove(
      run.people.writer,
      session.id,
      "DELETE",
    );

    for (const actor of [
      { ...run.people.writer, isActive: false },
      { ...run.people.writer, mustChangePassword: true },
    ])
      await expect(run.chatSessionService.open(actor)).rejects.toMatchObject({
        code: "accessDenied",
      });
  });
});
