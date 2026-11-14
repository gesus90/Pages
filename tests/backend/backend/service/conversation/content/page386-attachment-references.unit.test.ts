import { describe, expect, it, vi } from "vitest";

import { ConversationAttachmentReferences } from "@/backend/service/conversation/content/ConversationAttachmentReferences";

import type {
  StoredAttachmentReference,
  StoredLibraryAttachment,
} from "@/backend/database/repositories/conversation/ConversationAttachmentLibraryRepository";

const NOW = new Date("2026-11-15T12:00:00.000Z");

function original(
  id: string,
  overrides: { conversationId?: string; expiresAt?: string | null } = {},
): StoredLibraryAttachment {
  return {
    attachment: {
      id,
      conversationId: overrides.conversationId ?? "group",
      messageId: `message-${id}`,
      uploaderId: "conan",
      name: "Kosten.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 900,
      storageName: `store-${id}`,
      position: 0,
      thumbnail: null,
      createdAt: "2026-11-15T09:00:00.000Z",
      expiresAt: overrides.expiresAt ?? null,
    },
    messageId: `message-${id}`,
    senderId: "conan",
    sequence: 3,
    sentAt: "2026-11-15T09:00:00.000Z",
    hasText: false,
  };
}

function fixture(originals: StoredLibraryAttachment[]) {
  const library = {
    attachment: vi.fn(async (conversationId: string, id: string) =>
      originals.find(
        (entry) => entry.attachment.id === id && entry.attachment.conversationId === conversationId,
      ) ?? null,
    ),
    insertReferences: vi.fn().mockResolvedValue(undefined),
    referencesForMessages: vi.fn().mockResolvedValue(new Map()),
    findMany: vi.fn(async (ids: readonly string[]) =>
      new Map(originals.filter((entry) => ids.includes(entry.attachment.id)).map((entry) => [entry.attachment.id, entry])),
    ),
  };
  const conversations = { findForMember: vi.fn().mockResolvedValue({ id: "group" }) };
  const directory = {
    read: vi.fn().mockResolvedValue({
      participant: (id: string) => ({ id, name: id === "conan" ? "Conan" : id, kind: "agent", color: null }),
    }),
  };
  const references = new ConversationAttachmentReferences({
    library,
    conversations,
    directory: directory as never,
    now: () => NOW,
  });
  return { references, library, conversations };
}

function storedReference(attachmentId: string, conversationId = "group"): StoredAttachmentReference {
  return {
    messageId: "answer",
    position: 0,
    conversationId,
    attachmentId,
    name: "Kosten.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sourceMessageId: `message-${attachmentId}`,
    sourceSenderId: "conan",
    createdAt: NOW.toISOString(),
  };
}

describe("PAGE-386 reference lines in an answer", () => {
  it("takes a line that names an attachment of the same chat out of the text, without a copy", async () => {
    const { references, library } = fixture([original("table")]);
    const selection = await references.select(
      "group",
      "mei",
      "Siehe die Tabelle von Conan:\n![Kosten](anhang:table)\nDie Summe stimmt.",
    );
    expect(selection.text).toBe("Siehe die Tabelle von Conan:\nDie Summe stimmt.");
    expect(selection.references).toEqual([
      {
        attachmentId: "table",
        name: "Kosten.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sourceMessageId: "message-table",
        sourceSenderId: "conan",
      },
    ]);
    await references.bind({ id: "answer", conversationId: "group" }, selection.references);
    expect(library.insertReferences).toHaveBeenCalledWith([
      expect.objectContaining({ messageId: "answer", conversationId: "group", attachmentId: "table", position: 0 }),
    ]);
  });

  it("refuses an attachment of another chat and keeps the line with the reason", async () => {
    const { references } = fixture([original("secret", { conversationId: "other" })]);
    const selection = await references.select("group", "mei", "![x](anhang:secret)");
    expect(selection.references).toEqual([]);
    expect(selection.text).toBe("![x](anhang:secret) (Anhang nicht gezeigt: in diesem Chat nicht vorhanden)");
  });

  it("shows nothing for an agent that is no member of the chat", async () => {
    const { references, conversations, library } = fixture([original("table")]);
    conversations.findForMember.mockResolvedValue(null);
    const selection = await references.select("group", "mallory", "![x](anhang:table)");
    expect(selection.references).toEqual([]);
    expect(library.attachment).not.toHaveBeenCalled();
  });

  it("leaves lines inside code blocks as text", async () => {
    const { references } = fixture([original("table")]);
    const text = "```\n![x](anhang:table)\n```";
    const selection = await references.select("group", "mei", text);
    expect(selection).toEqual({ text, references: [] });
  });
});

describe("PAGE-386 reference cards", () => {
  it("shows the original with its sender and message, expired and deleted ones as placeholders", async () => {
    const { references, library } = fixture([
      original("table"),
      original("old", { expiresAt: "2026-11-15T10:00:00.000Z" }),
      original("foreign", { conversationId: "other" }),
    ]);
    library.referencesForMessages.mockResolvedValue(
      new Map([
        [
          "answer",
          [
            storedReference("table"),
            { ...storedReference("old"), position: 1 },
            { ...storedReference("gone"), position: 2 },
            { ...storedReference("foreign"), position: 3 },
          ],
        ],
      ]),
    );
    const views = await references.forMessages(["answer"]);
    const [table, old, gone, foreign] = views.get("answer") ?? [];
    expect(table).toMatchObject({
      attachmentId: "table",
      state: "available",
      senderName: "Conan",
      sourceMessageId: "message-table",
      sentAt: "2026-11-15T09:00:00.000Z",
      attachment: { id: "table", url: "/chat/files/table", name: "Kosten.xlsx" },
    });
    expect(old).toMatchObject({ state: "expired", attachment: { expiredAt: NOW.toISOString() } });
    expect(gone).toEqual({
      attachmentId: "gone",
      state: "deleted",
      name: "Kosten.xlsx",
      sourceMessageId: "message-gone",
      senderName: "Conan",
    });
    expect(foreign).toMatchObject({ state: "deleted" });
    expect(foreign).not.toHaveProperty("attachment");
  });
});
