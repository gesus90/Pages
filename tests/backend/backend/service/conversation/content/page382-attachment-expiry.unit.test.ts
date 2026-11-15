import { PassThrough } from "node:stream";
import { crc32 } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

import { ConversationError } from "@/backend/error/ConversationError";
import { ConversationAttachmentExpiry } from "@/backend/service/conversation/content/ConversationAttachmentExpiry";
import {
  ConversationAttachments,
  isConversationAttachmentExpired,
  toConversationAttachment,
} from "@/backend/service/conversation/content/ConversationAttachments";
import {
  archiveNames,
  archiveSize,
  zipArchive,
} from "@/backend/service/conversation/content/ConversationZipArchive";

import type { StoredConversationAttachment } from "@/backend/database/repositories/conversation/ConversationAttachmentRepository";
import type { ConversationAttachmentsDependencies } from "@/backend/service/conversation/content/ConversationAttachments";
import type { User } from "@/definition/User";

const NOW = new Date("2026-11-14T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const member: User = {
  id: "person-1",
  username: "person-1",
  displayName: "Igor",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};

function stored(
  overrides: Partial<StoredConversationAttachment> = {},
): StoredConversationAttachment {
  return {
    id: "att-1",
    conversationId: "conv-1",
    messageId: "msg-1",
    uploaderId: "agent-1",
    name: "fuchs.png",
    mimeType: "image/png",
    sizeBytes: 3,
    storageName: "store-1",
    position: 0,
    thumbnail: { storageName: "thumb-1", mimeType: "image/webp", sizeBytes: 1 },
    createdAt: "2026-11-14T11:00:00.000Z",
    expiresAt: null,
    expiredAt: null,
    ...overrides,
  };
}

function streamOf(text: string): PassThrough {
  const stream = new PassThrough();
  stream.end(Buffer.from(text));
  return stream;
}

interface AttachmentRepositoryMock {
  insert: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
  forMessages: ReturnType<typeof vi.fn>;
  expireDue: ReturnType<typeof vi.fn>;
  imagesOfConversation: ReturnType<typeof vi.fn>;
}

function setup(
  attachments: Partial<AttachmentRepositoryMock> = {},
  isMember = true,
): {
  service: ConversationAttachments;
  dependencies: {
    attachments: AttachmentRepositoryMock;
    files: {
      write: ReturnType<typeof vi.fn>;
      open: ReturnType<typeof vi.fn>;
      remove: ReturnType<typeof vi.fn>;
      sweep: ReturnType<typeof vi.fn>;
    };
  };
} {
  const repository: AttachmentRepositoryMock = {
    insert: vi.fn().mockResolvedValue(undefined),
    find: vi.fn(),
    forMessages: vi.fn().mockResolvedValue(new Map()),
    expireDue: vi.fn().mockResolvedValue([]),
    imagesOfConversation: vi.fn().mockResolvedValue([]),
    ...attachments,
  };
  const files = {
    write: vi.fn().mockResolvedValue({ storageName: "new-store", size: 3 }),
    open: vi.fn((name: string) => streamOf(`bytes-of-${name}`)),
    remove: vi.fn().mockResolvedValue(undefined),
    sweep: vi.fn().mockResolvedValue(0),
  };
  const service = new ConversationAttachments({
    attachments:
      repository as unknown as ConversationAttachmentsDependencies["attachments"],
    conversations: {
      findForMember: vi
        .fn()
        .mockResolvedValue(isMember ? { id: "conv-1" } : null),
    },
    files: files as unknown as ConversationAttachmentsDependencies["files"],
    directory: {
      read: () =>
        Promise.resolve({
          participant: (id: string) => ({
            name: id === "agent-1" ? "Ed" : "Igor",
          }),
        }),
    },
    now: () => NOW,
    createId: () => "att-new",
  });
  return {
    service,
    dependencies: { attachments: repository, files },
  };
}

describe("files of agents expire after 72 hours (PAGE-382)", () => {
  it("stores a staged file of an agent with a moment 72 hours from now", async () => {
    const { service, dependencies } = setup();
    const result = await service.stage(
      { conversationId: "conv-1", senderId: "agent-1" },
      { name: "a.png", mimeType: "image/png", source: streamOf("abc") },
    );
    expect(result.expiresAt).toBe("2026-11-17T12:00:00.000Z");
    expect(dependencies.attachments.insert).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: "2026-11-17T12:00:00.000Z" }),
    );
  });

  it("keeps uploads of people without an expiry", async () => {
    const { service, dependencies } = setup();
    const result = await service.upload(
      member,
      { conversationId: "conv-1", name: "foto.png", mimeType: "image/png" },
      streamOf("abc"),
    );
    expect(result.expiresAt).toBeUndefined();
    expect(dependencies.attachments.insert).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: null }),
    );
  });

  it("removes the files and preview images of due attachments before their moment", async () => {
    const { service, dependencies } = setup({
      expireDue: vi.fn().mockResolvedValue(["store-1", "thumb-1"]),
    });
    expect(await service.expire()).toBe(2);
    // One interval early, so nothing waits beyond 72 hours for the next run.
    expect(dependencies.attachments.expireDue).toHaveBeenCalledWith(
      "2026-11-14T12:05:00.000Z",
      "2026-11-14T12:00:00.000Z",
    );
    expect(dependencies.files.remove).toHaveBeenCalledWith([
      "store-1",
      "thumb-1",
    ]);
  });

  it("removes nothing when nothing is due", async () => {
    const { service, dependencies } = setup();
    expect(await service.expire()).toBe(0);
    expect(dependencies.files.remove).not.toHaveBeenCalled();
  });

  it("refuses the original and the preview of an expired file", async () => {
    const { service } = setup({
      find: vi
        .fn()
        .mockResolvedValue(stored({ expiredAt: "2026-11-14T10:00:00.000Z" })),
    });
    await expect(
      service.open(member, { attachmentId: "att-1", variant: "original" }),
    ).rejects.toEqual(new ConversationError("not_found"));
  });

  it("refuses a file whose moment passed before the next run of the expiry", async () => {
    const { service } = setup({
      find: vi
        .fn()
        .mockResolvedValue(stored({ expiresAt: "2026-11-14T11:59:00.000Z" })),
    });
    await expect(
      service.open(member, { attachmentId: "att-1", variant: "thumbnail" }),
    ).rejects.toEqual(new ConversationError("not_found"));
  });

  it("still serves a file of an agent before its moment", async () => {
    const { service } = setup({
      find: vi
        .fn()
        .mockResolvedValue(stored({ expiresAt: "2026-11-15T12:00:00.000Z" })),
    });
    const opened = await service.open(member, {
      attachmentId: "att-1",
      variant: "original",
    });
    expect(opened.name).toBe("fuchs.png");
  });
});

describe("expired attachment representation and runner (PAGE-382)", () => {
  it("shows an expired attachment with name and dates but without a preview", () => {
    const attachment = toConversationAttachment(
      stored({
        expiresAt: "2026-11-14T11:00:00.000Z",
        expiredAt: "2026-11-14T11:00:01.000Z",
      }),
    );
    expect(attachment).toMatchObject({
      name: "fuchs.png",
      createdAt: "2026-11-14T11:00:00.000Z",
      expiredAt: "2026-11-14T11:00:01.000Z",
    });
    expect(attachment.thumbnailUrl).toBeUndefined();
  });

  it("tells expired from kept files", () => {
    expect(isConversationAttachmentExpired({ expiresAt: null }, NOW)).toBe(
      false,
    );
    expect(
      isConversationAttachmentExpired(
        { expiresAt: new Date(NOW.getTime() + HOUR).toISOString() },
        NOW,
      ),
    ).toBe(false);
    expect(
      isConversationAttachmentExpired(
        { expiresAt: NOW.toISOString(), expiredAt: null },
        NOW,
      ),
    ).toBe(true);
  });

  it("runs the expiry at once on start, so a restart removes what ran out meanwhile", async () => {
    const expire = vi.fn().mockResolvedValue(0);
    const expiry = new ConversationAttachmentExpiry({ expire });
    expiry.start();
    expiry.start();
    await expiry.shutdown();
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it("logs a failed run and keeps going", async () => {
    const expire = vi.fn().mockRejectedValue(new Error("db down"));
    const expiry = new ConversationAttachmentExpiry({ expire });
    await expect(expiry.runDue()).resolves.toBeUndefined();
    await expect(expiry.runDue()).resolves.toBeUndefined();
    expect(expire).toHaveBeenCalledTimes(2);
  });
});

describe("images of a chat for the viewer (PAGE-382)", () => {
  it("lists the images of a conversation with sender and time for a member", async () => {
    const { service } = setup({
      imagesOfConversation: vi.fn().mockResolvedValue([
        {
          attachment: stored(),
          messageId: "msg-1",
          senderId: "agent-1",
          sentAt: "2026-11-14T11:00:00.100Z",
        },
        {
          attachment: stored({
            id: "att-2",
            expiresAt: "2026-11-14T11:30:00.000Z",
          }),
          messageId: "msg-2",
          senderId: "person-1",
          sentAt: "2026-11-14T11:10:00.000Z",
        },
      ]),
    });
    const images = await service.images(member, "conv-1");
    expect(images.map((image) => image.senderName)).toEqual(["Ed", "Igor"]);
    expect(images[0]?.attachment.expiredAt).toBeUndefined();
    // Ran out before the next run of the expiry: reported as expired already.
    expect(images[1]?.attachment.expiredAt).toBe(NOW.toISOString());
  });

  it("answers not_found to a person who is no member", async () => {
    const { service, dependencies } = setup({}, false);
    await expect(service.images(member, "conv-1")).rejects.toEqual(
      new ConversationError("not_found"),
    );
    expect(
      dependencies.attachments.imagesOfConversation,
    ).not.toHaveBeenCalled();
  });
});

describe("all files of a message as ZIP (PAGE-382)", () => {
  it("archives the files of a message that are still there", async () => {
    const { service } = setup({
      forMessages: vi.fn().mockResolvedValue(
        new Map([
          [
            "msg-1",
            [
              stored(),
              stored({
                id: "att-2",
                storageName: "store-2",
                name: "fuchs.png",
              }),
              stored({
                id: "att-3",
                storageName: "store-3",
                expiredAt: "2026-11-14T10:00:00.000Z",
              }),
            ],
          ],
        ]),
      ),
    });
    const { entries } = await service.archive(member, "msg-1");
    expect(entries.map((entry) => entry.name)).toEqual([
      "fuchs.png",
      "fuchs.png",
    ]);
  });

  it("refuses a message of a conversation the person does not belong to", async () => {
    const { service } = setup(
      {
        forMessages: vi
          .fn()
          .mockResolvedValue(new Map([["msg-1", [stored()]]])),
      },
      false,
    );
    await expect(service.archive(member, "msg-1")).rejects.toEqual(
      new ConversationError("not_found"),
    );
  });

  it("refuses a message whose files all expired", async () => {
    const { service } = setup({
      forMessages: vi
        .fn()
        .mockResolvedValue(
          new Map([
            ["msg-1", [stored({ expiredAt: "2026-11-14T10:00:00.000Z" })]],
          ]),
        ),
    });
    await expect(service.archive(member, "msg-1")).rejects.toEqual(
      new ConversationError("not_found"),
    );
  });

  it("numbers repeated names so no file replaces another", () => {
    expect(archiveNames(["a.png", "a.png", "A.png", "b"])).toEqual([
      "a.png",
      "a (2).png",
      "A (3).png",
      "b",
    ]);
  });

  it("writes a valid ZIP that keeps names and bytes", async () => {
    const entries = [
      { name: "eins.png", sizeBytes: 5, open: () => streamOf("hallo") },
      { name: "zwei-ä.txt", sizeBytes: 4, open: () => streamOf("welt") },
    ];
    const chunks: Uint8Array[] = [];
    for await (const chunk of zipArchive(entries, NOW)) chunks.push(chunk);
    const zip = Buffer.concat(chunks);
    expect(zip.length).toBe(archiveSize(entries));
    // End of central directory: two entries.
    const end = zip.subarray(zip.length - 22);
    expect(end.readUInt32LE(0)).toBe(0x06054b50);
    expect(end.readUInt16LE(10)).toBe(2);
    // First local header: stored, its name and its bytes.
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt16LE(8)).toBe(0);
    const nameLength = zip.readUInt16LE(26);
    expect(zip.subarray(30, 30 + nameLength).toString("utf8")).toBe("eins.png");
    expect(
      zip.subarray(30 + nameLength, 30 + nameLength + 5).toString("utf8"),
    ).toBe("hallo");
    expect(zip.includes(Buffer.from("zwei-ä.txt", "utf8"))).toBe(true);
    expect(zip.readUInt32LE(14)).toBe(crc32(Buffer.from("hallo")));
  });
});
