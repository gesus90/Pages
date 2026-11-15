import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { ConversationError } from "@/backend/error/ConversationError";
import { findMessageLinks } from "@/backend/service/conversation/content/ConversationMessageLinks";
import {
  ConversationMediaOverviewService,
  readMediaArchiveIds,
} from "@/backend/service/conversation/content/ConversationMediaOverviewService";

import type { StoredLibraryAttachment } from "@/backend/database/repositories/conversation/ConversationAttachmentLibraryRepository";
import type { StoredConversationAttachment } from "@/backend/database/repositories/conversation/ConversationAttachmentRepository";
import type { StoredLinkedMessage } from "@/backend/database/repositories/conversation/ConversationMediaOverviewRepository";
import type { User } from "@/definition/User";

const NOW = new Date("2026-11-15T12:00:00.000Z");
const PERSON: User = {
  id: "igor",
  username: "igor",
  displayName: "Igor",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const PARTICIPANTS: Record<string, { name: string; kind: "human" | "agent" }> =
  {
    igor: { name: "Igor", kind: "human" },
    ed: { name: "Ed", kind: "agent" },
  };

function stored(
  id: string,
  overrides: Partial<StoredConversationAttachment> & {
    senderId?: string;
    sentAt?: string;
  } = {},
): StoredLibraryAttachment {
  const {
    senderId = "igor",
    sentAt = "2026-11-15T08:00:00.000Z",
    ...attachment
  } = overrides;
  return {
    attachment: {
      id,
      conversationId: "group",
      messageId: `message-${id}`,
      uploaderId: senderId,
      name: `${id}.png`,
      mimeType: "image/png",
      sizeBytes: 2048,
      storageName: `store-${id}`,
      position: 0,
      thumbnail: null,
      createdAt: sentAt,
      ...attachment,
    },
    messageId: `message-${id}`,
    senderId,
    sequence: 1,
    sentAt,
    hasText: false,
  };
}

const ATTACHMENTS: StoredLibraryAttachment[] = [
  stored("photo"),
  stored("clip", { name: "clip.mp4", mimeType: "video/mp4" }),
  stored("song", { name: "song.mp3", mimeType: "audio/mpeg" }),
  stored("report", {
    name: "Bericht.pdf",
    mimeType: "application/pdf",
    senderId: "ed",
    expiresAt: "2026-11-15T20:00:00.000Z",
  }),
  stored("sheet", {
    name: "Zahlen.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }),
  stored("notes", { name: "notes.txt", mimeType: "text/plain" }),
  stored("backup", { name: "backup.tar.gz", mimeType: "application/gzip" }),
  stored("old", {
    name: "old.png",
    senderId: "ed",
    expiresAt: "2026-11-15T11:00:00.000Z",
  }),
];

const MESSAGES: StoredLinkedMessage[] = [
  {
    messageId: "m-links",
    senderId: "ed",
    sentAt: "2026-11-15T09:00:00.000Z",
    text: "Siehe [Plan](https://pages.example/plan) und https://docs.example.org/a.\n```\nhttps://code.example/ignored\n```",
  },
];

function fixture(options: { isMember?: boolean } = {}): {
  service: ConversationMediaOverviewService;
  library: { attachments: ReturnType<typeof vi.fn> };
  messages: { linkedMessages: ReturnType<typeof vi.fn> };
  previews: { find: ReturnType<typeof vi.fn> };
  conversations: { findForMember: ReturnType<typeof vi.fn> };
  files: { open: ReturnType<typeof vi.fn> };
} {
  const library = { attachments: vi.fn().mockResolvedValue(ATTACHMENTS) };
  const messages = { linkedMessages: vi.fn().mockResolvedValue(MESSAGES) };
  const previews = {
    find: vi.fn().mockResolvedValue(
      new Map([
        [
          "https://docs.example.org/a",
          {
            url: "https://docs.example.org/a",
            title: "Doku A",
            description: "",
            image: { storageName: "x", mimeType: "image/png" },
            fetchedAt: NOW.toISOString(),
          },
        ],
      ]),
    ),
  };
  const conversations = {
    findForMember: vi
      .fn()
      .mockResolvedValue(options.isMember === false ? null : { id: "group" }),
  };
  const files = {
    open: vi.fn((name: string) => Readable.from([Buffer.from(name)])),
  };
  const directory = {
    read: vi.fn().mockResolvedValue({
      participant: (id: string) => ({
        id,
        color: null,
        ...(PARTICIPANTS[id] ?? { name: "—", kind: "human" }),
      }),
    }),
  };
  const service = new ConversationMediaOverviewService({
    library,
    messages,
    previews,
    conversations,
    files: files as never,
    directory,
    now: () => NOW,
  });
  return { service, library, messages, previews, conversations, files };
}

describe("Medien & Dateien of a chat (PAGE-387)", () => {
  it("sorts every file of the chat into its tab, newest first as stored, and marks a file whose 72 hours ran out", async () => {
    const { service, library } = fixture();
    const overview = await service.overview(PERSON, "group");
    expect(library.attachments).toHaveBeenCalledWith("group");
    expect(
      overview.files.map((file) => [file.attachment.id, file.tab]),
    ).toEqual([
      ["photo", "images"],
      ["clip", "videos"],
      ["song", "audio"],
      ["report", "documents"],
      ["sheet", "documents"],
      ["notes", "documents"],
      ["backup", "files"],
      ["old", "images"],
    ]);
    const old = overview.files.find((file) => file.attachment.id === "old");
    expect(old?.attachment.expiredAt).toBe(NOW.toISOString());
    const report = overview.files.find(
      (file) => file.attachment.id === "report",
    );
    expect(report?.attachment.expiresAt).toBe("2026-11-15T20:00:00.000Z");
    expect(report?.attachment.expiredAt).toBeUndefined();
    expect(report?.messageId).toBe("message-report");
  });

  it("lists links with domain, the stored title or the text of the link, and their sender; code is left out and nothing is fetched", async () => {
    const { service, previews } = fixture();
    const overview = await service.overview(PERSON, "group");
    expect(previews.find).toHaveBeenCalledWith([
      "https://pages.example/plan",
      "https://docs.example.org/a",
    ]);
    expect(overview.links).toHaveLength(2);
    expect(overview.links[0]).toMatchObject({
      url: "https://pages.example/plan",
      domain: "pages.example",
      title: "Plan",
      imageUrl: null,
      senderId: "ed",
      messageId: "m-links",
    });
    expect(overview.links[1]).toMatchObject({
      url: "https://docs.example.org/a",
      domain: "docs.example.org",
      title: "Doku A",
    });
    expect(overview.links[1]?.imageUrl).toContain("/chat/link-image?url=");
  });

  it("names every sender once with person or agent for the filter", async () => {
    const { service } = fixture();
    const overview = await service.overview(PERSON, "group");
    expect(overview.senders).toEqual([
      { id: "ed", name: "Ed", kind: "agent" },
      { id: "igor", name: "Igor", kind: "human" },
    ]);
  });

  it("answers not_found to anybody who is no member and reads nothing", async () => {
    const { service, library, messages } = fixture({ isMember: false });
    await expect(service.overview(PERSON, "group")).rejects.toEqual(
      new ConversationError("not_found"),
    );
    await expect(service.overview(PERSON, "../x")).rejects.toEqual(
      new ConversationError("not_found"),
    );
    await expect(
      service.archive(PERSON, { conversationId: "group", ids: "photo" }),
    ).rejects.toEqual(new ConversationError("not_found"));
    expect(library.attachments).not.toHaveBeenCalled();
    expect(messages.linkedMessages).not.toHaveBeenCalled();
  });

  it("puts only the chosen files of the chat that are still there into one archive", async () => {
    const { service, files } = fixture();
    const { entries } = await service.archive(PERSON, {
      conversationId: "group",
      ids: "photo,report,old,foreign",
    });
    expect(entries.map((entry) => entry.name)).toEqual([
      "photo.png",
      "Bericht.pdf",
    ]);
    entries[1]?.open();
    expect(files.open).toHaveBeenCalledWith("store-report");
    await expect(
      service.archive(PERSON, { conversationId: "group", ids: "old" }),
    ).rejects.toEqual(new ConversationError("not_found"));
  });

  it("reads the chosen IDs once each and refuses none or more than 200", () => {
    expect(readMediaArchiveIds("a, b,a,../x")).toEqual(["a", "b"]);
    expect(() => readMediaArchiveIds("")).toThrow(ConversationError);
    expect(() => readMediaArchiveIds(null)).toThrow(ConversationError);
    expect(() =>
      readMediaArchiveIds(
        Array.from({ length: 201 }, (_, index) => `id-${index}`).join(","),
      ),
    ).toThrow(ConversationError);
  });
});

describe("links of a message for the overview (PAGE-387)", () => {
  it("finds Markdown links with their text and bare addresses once, outside code, without trailing signs", () => {
    expect(
      findMessageLinks(
        "Lies [Doku](https://a.example/doc) oder https://a.example/doc, dann https://b.example/x).\n`https://inline.example` und <https://c.example/>\n~~~\nhttps://fenced.example\n~~~\nhttps://user:pw@d.example/",
      ),
    ).toEqual([
      { url: "https://a.example/doc", label: "Doku" },
      { url: "https://b.example/x", label: "" },
      { url: "https://c.example/", label: "" },
    ]);
  });
});
