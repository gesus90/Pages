import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { ChatAttachmentRepository } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { ChatError } from "@/backend/error/ChatErrors";
import {
  ChatAttachmentService,
  isChatTextAttachment,
} from "@/backend/service/chat/ChatAttachmentService";
import { ChatSessionService } from "@/backend/service/chat/ChatSessionService";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";

import { useChatHarness } from "../helpers/chat-harness";

import type { ChatHarness } from "../helpers/chat-harness";
import type { ChatSession } from "@/definition/Chat";

const setup = useChatHarness();
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);

function fileOf(
  name: string,
  content: Buffer,
  contentLength: number | null = null,
) {
  return {
    fileName: name,
    contentLength,
    body: Readable.from([content]),
  };
}

function storeOf(run: ChatHarness): WikiFileStore {
  return new WikiFileStore(path.join(run.directory, "g4-attachments"));
}

function filesIn(directory: string): readonly string[] {
  return existsSync(directory) ? readdirSync(directory) : [];
}

function attachmentsOf(
  run: ChatHarness,
  overrides: Partial<
    ConstructorParameters<typeof ChatAttachmentService>[0]
  > = {},
): ChatAttachmentService {
  return new ChatAttachmentService({
    sessions: new ChatSessionRepository(run.database),
    attachments: new ChatAttachmentRepository(run.database),
    settings: run.chatSettingsService,
    files: storeOf(run),
    isSafeSvg: () => true,
    ...overrides,
  });
}

describe("A11.10 g4: chat messages", () => {
  it("refuses a request ID that is not an identifier, for sending and for cancelling", async () => {
    const run = await setup();
    const actor = run.people.writer;
    const { session } = await run.chatSessionService.open(actor);
    await expect(
      run.chatService.send(actor, {
        requestId: "../etc/passwd",
        sessionId: session.id,
        text: "Hallo",
        attachmentIds: [],
      }),
    ).rejects.toMatchObject({ code: "invalidInput" });
    expect(() => run.chatService.cancel(actor, 42)).toThrow(ChatError);
    expect(() => run.chatService.cancel(actor, "../x")).toThrow(
      expect.objectContaining({ code: "invalidInput" }),
    );
    expect(run.execution.run).not.toHaveBeenCalled();
  });

  it("cancels a running answer of the person before the answer is stored", async () => {
    const run = await setup();
    const actor = run.people.writer;
    const { session } = await run.chatSessionService.open(actor);
    const requestId = randomUUID();
    run.execution.run.mockImplementation(async () => {
      run.chatService.cancel(actor, requestId);
      return "Eine Antwort, die niemand mehr bekommt.";
    });
    await expect(
      run.chatService.send(actor, {
        requestId,
        sessionId: session.id,
        text: "Hallo",
        attachmentIds: [],
      }),
    ).rejects.toMatchObject({ code: "cancelled" });
    const view = await run.chatSessionService.view(actor, session.id);
    expect(view.messages.map(({ role }) => role)).toEqual(["user"]);
  });

  it("stops new answers once the service shuts down", async () => {
    const run = await setup();
    run.execution.run.mockResolvedValue("Hallo!");
    await run.ask("writer", "Vor dem Herunterfahren");
    await run.chatService.shutdown();
    await expect(run.ask("writer", "Danach")).rejects.toMatchObject({
      code: "requestBusy",
    });
    expect(run.execution.run).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an empty reply", ""],
    ["a reply longer than the answer limit", "ab ".repeat(70_000)],
  ])("rejects %s of the model and stores no answer", async (_name, reply) => {
    const run = await setup();
    const actor = run.people.writer;
    const { session } = await run.chatSessionService.open(actor);
    run.execution.run.mockResolvedValue(reply);
    await expect(
      run.chatService.send(actor, {
        requestId: randomUUID(),
        sessionId: session.id,
        text: "Hallo",
        attachmentIds: [],
      }),
    ).rejects.toMatchObject({ code: "invalidOutput" });
    const view = await run.chatSessionService.view(actor, session.id);
    expect(view.messages.map(({ role }) => role)).toEqual(["user"]);
  });

  it("gives the agent the text of text attachments and only name and type of other files", async () => {
    const run = await setup();
    const actor = run.people.writer;
    const { session } = await run.chatSessionService.open(actor);
    const text = await run.chatAttachmentService.upload(
      actor,
      session.id,
      fileOf("notes.txt", Buffer.from("Besprechungsnotizen")),
    );
    const image = await run.chatAttachmentService.upload(
      actor,
      session.id,
      fileOf("photo.png", PNG),
    );
    run.execution.run.mockResolvedValue("Gesehen.");
    await run.chatService.send(actor, {
      requestId: randomUUID(),
      sessionId: session.id,
      text: "Bitte lesen",
      attachmentIds: [text.id, image.id],
    });
    const { prompt } = run.execution.run.mock.calls[0][0];
    expect(prompt).toContain(
      '{"fileName":"notes.txt","contentType":"text/plain","size":19,"text":"Besprechungsnotizen"}',
    );
    expect(prompt).toContain(
      `{"fileName":"photo.png","contentType":"image/png","size":${PNG.length},"text":null}`,
    );
  });
});

describe("A11.10 g4: chat sessions", () => {
  it("draws another ID when the stored session cannot be read back", async () => {
    const run = await setup();
    class UnreadableOnceRepository extends ChatSessionRepository {
      private unreadable = 1;

      public override async find(
        userId: string,
        id: string,
      ): Promise<ChatSession | null> {
        if (this.unreadable > 0) {
          this.unreadable -= 1;
          return null;
        }
        return super.find(userId, id);
      }
    }
    const ids = ["haus-baum-zelt-rabe-mond", "boot-dach-eule-fass-gold"];
    const sessions = new ChatSessionService({
      sessions: new UnreadableOnceRepository(run.database),
      attachments: new ChatAttachmentRepository(run.database),
      settings: run.chatSettingsService,
      languages: new UserSettingsRepository(run.database),
      files: { remove: async () => undefined },
      createId: () => ids.shift() ?? "boot-dach-eule-fass-gold",
    });
    expect((await sessions.create(run.people.writer)).session.id).toBe(
      "boot-dach-eule-fass-gold",
    );
  });
});

describe("A11.10 g4: chat attachments", () => {
  it("recognizes the attachment types that reach the agent as text", () => {
    expect(isChatTextAttachment("text/markdown")).toBe(true);
    expect(isChatTextAttachment("application/json")).toBe(true);
    expect(isChatTextAttachment("application/pdf")).toBe(false);
    expect(isChatTextAttachment("image/png")).toBe(false);
  });

  it("refuses an attachment ID that is not an identifier when opening and discarding", async () => {
    const run = await setup();
    for (const id of ["../etc/passwd", 7, "", "a".repeat(101)]) {
      await expect(
        run.chatAttachmentService.open(run.people.writer, id),
      ).rejects.toMatchObject({ code: "invalidInput" });
      await expect(
        run.chatAttachmentService.discard(run.people.writer, id),
      ).rejects.toMatchObject({ code: "invalidInput" });
    }
  });

  it("checks the attachment list of a message before it is sent", async () => {
    const run = await setup();
    const actor = run.people.writer;
    const { session } = await run.chatSessionService.open(actor);
    const service = run.chatAttachmentService;
    const stored = await service.upload(
      actor,
      session.id,
      fileOf("notes.txt", Buffer.from("Notizen")),
    );
    await expect(
      service.pending(session.id, "not a list"),
    ).rejects.toMatchObject({ code: "invalidInput" });
    await expect(
      service.pending(
        session.id,
        Array.from({ length: 11 }, (_unused, index) => `id-${index}`),
      ),
    ).rejects.toMatchObject({ code: "tooManyAttachments" });
    await expect(
      service.pending(session.id, [stored.id, "unknown-attachment"]),
    ).rejects.toMatchObject({ code: "attachmentMissing" });
    await expect(service.pending(session.id, ["../x"])).rejects.toMatchObject({
      code: "invalidInput",
    });
    const pending = await service.pending(session.id, [stored.id]);
    expect(pending.map(({ id }) => id)).toEqual([stored.id]);
  });

  it("reads only the start of a long text attachment, counted in characters", async () => {
    const run = await setup();
    const actor = run.people.writer;
    const { session } = await run.chatSessionService.open(actor);
    const service = run.chatAttachmentService;
    const long = await service.upload(
      actor,
      session.id,
      fileOf("long.txt", Buffer.from("wort ".repeat(40_000))),
    );
    const umlauts = await service.upload(
      actor,
      session.id,
      fileOf("umlaute.txt", Buffer.from("äöü".repeat(100))),
    );
    const pending = await service.pending(session.id, [long.id, umlauts.id]);
    const first = pending.find(({ id }) => id === long.id);
    const second = pending.find(({ id }) => id === umlauts.id);
    if (!first || !second) throw new Error("Missing pending attachment.");
    expect(await service.readText(first, 12)).toBe("wort wort wo");
    expect(await service.readText(second, 5)).toBe("äöüäö");
    expect(await service.readText(second, 1_000)).toHaveLength(300);
  });

  it("stops a file that outgrows the limit while it streams and leaves nothing behind", async () => {
    const run = await setup();
    const { session } = await run.chatSessionService.open(run.people.writer);
    const service = attachmentsOf(run, {
      settings: {
        read: async () => ({
          ...(await run.chatSettingsService.read()),
          attachmentLimitBytes: 16,
        }),
      },
    });
    await expect(
      service.upload(
        run.people.writer,
        session.id,
        fileOf("big.txt", Buffer.from("a".repeat(100))),
      ),
    ).rejects.toMatchObject({ code: "fileTooLarge" });
    expect(filesIn(path.join(run.directory, "g4-attachments"))).toEqual([]);
    await expect(
      service.upload(
        run.people.writer,
        session.id,
        fileOf("small.txt", Buffer.from("a".repeat(16))),
      ),
    ).resolves.toMatchObject({ size: 16 });
  });

  it("refuses a file whose announced size exceeds the limit before it is stored", async () => {
    const run = await setup();
    const { session } = await run.chatSessionService.open(run.people.writer);
    const write = vi.fn<WikiFileStore["write"]>();
    const service = attachmentsOf(run, {
      files: { write, open: vi.fn(), remove: vi.fn() },
      settings: {
        read: async () => ({
          ...(await run.chatSettingsService.read()),
          attachmentLimitBytes: 16,
        }),
      },
    });
    await expect(
      service.upload(
        run.people.writer,
        session.id,
        fileOf("announced.txt", Buffer.from("a"), 17),
      ),
    ).rejects.toMatchObject({ code: "fileTooLarge" });
    expect(write).not.toHaveBeenCalled();
  });

  it("passes on an unexpected failure of the file store", async () => {
    const run = await setup();
    const { session } = await run.chatSessionService.open(run.people.writer);
    const service = attachmentsOf(run, {
      files: {
        write: vi.fn().mockRejectedValue(new Error("disk full")),
        open: vi.fn(),
        remove: vi.fn(),
      },
    });
    await expect(
      service.upload(
        run.people.writer,
        session.id,
        fileOf("notes.txt", Buffer.from("Notizen")),
      ),
    ).rejects.toThrow("disk full");
  });

  it("removes the stored file when the session vanished before the attachment was recorded", async () => {
    const run = await setup();
    const ghost: ChatSession = {
      id: "haus-baum-zelt-rabe-mond",
      createdAt: "2026-10-12T08:00:00Z",
      lastMessageAt: "2026-10-12T08:00:00Z",
      preview: "",
    };
    const service = attachmentsOf(run, {
      sessions: { find: async () => ghost },
    });
    await expect(
      service.upload(
        run.people.writer,
        ghost.id,
        fileOf("notes.txt", Buffer.from("Notizen")),
      ),
    ).rejects.toMatchObject({ code: "sessionMissing" });
    expect(filesIn(path.join(run.directory, "g4-attachments"))).toEqual([]);
  });
});
