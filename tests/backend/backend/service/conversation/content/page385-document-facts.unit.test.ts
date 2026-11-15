import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { ConversationError } from "@/backend/error/ConversationError";
import {
  ConversationAttachments,
  toConversationAttachment,
} from "@/backend/service/conversation/content/ConversationAttachments";
import {
  conversationDocumentFactsOf,
  readConversationDocumentFacts,
} from "@/backend/service/conversation/content/ConversationDocumentFacts";

import type { StoredConversationAttachment } from "@/backend/database/repositories/conversation/ConversationAttachmentRepository";
import type { ConversationAttachmentsDependencies } from "@/backend/service/conversation/content/ConversationAttachments";
import type { User } from "@/definition/User";

const NOW = new Date("2026-11-14T12:00:00.000Z");
const member: User = {
  id: "person-1",
  username: "person-1",
  displayName: "Person 1",
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
    name: "bericht.pdf",
    mimeType: "application/pdf",
    sizeBytes: 3,
    storageName: "store-1",
    position: 0,
    thumbnail: null,
    createdAt: "2026-11-14T11:00:00.000Z",
    expiresAt: "2026-11-17T11:00:00.000Z",
    expiredAt: null,
    media: null,
    document: null,
    sha256: null,
    ...overrides,
  };
}

async function* chunks(...parts: string[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield Buffer.from(part);
}

async function drain(source: AsyncIterable<Uint8Array>): Promise<number> {
  let size = 0;
  for await (const chunk of source) size += chunk.length;
  return size;
}

function setup(
  options: {
    readonly attachment?: StoredConversationAttachment | null;
    readonly isMember?: boolean;
  } = {},
): {
  service: ConversationAttachments;
  repository: Record<string, ReturnType<typeof vi.fn>>;
} {
  const attachment =
    options.attachment === undefined ? stored() : options.attachment;
  const repository = {
    insert: vi.fn().mockResolvedValue(undefined),
    find: vi.fn().mockResolvedValue(attachment),
    setMediaFacts: vi.fn().mockResolvedValue(true),
    setDocumentFacts: vi.fn().mockResolvedValue(true),
    setThumbnail: vi.fn().mockResolvedValue(true),
  };
  const service = new ConversationAttachments({
    attachments:
      repository as unknown as ConversationAttachmentsDependencies["attachments"],
    conversations: {
      findForMember: vi
        .fn()
        .mockResolvedValue(
          options.isMember === false ? null : { id: "conv-1" },
        ),
    },
    files: {
      write: vi.fn(async (source: AsyncIterable<Uint8Array>) => ({
        storageName: "store-new",
        size: await drain(source),
      })),
      open: vi.fn(() => new PassThrough()),
      remove: vi.fn().mockResolvedValue(undefined),
      sweep: vi.fn().mockResolvedValue(0),
    } as unknown as ConversationAttachmentsDependencies["files"],
    now: () => NOW,
    createId: () => "att-new",
  });
  return { service, repository };
}

describe("checksum of every stored file (PAGE-385)", () => {
  it("computes the SHA-256 of an upload of a person while it streams", async () => {
    const { service, repository } = setup();
    const attachment = await service.upload(
      member,
      {
        conversationId: "conv-1",
        name: "backup.zip",
        mimeType: "application/zip",
      },
      chunks("PK", "\u0003\u0004", "rest"),
    );
    const expected = createHash("sha256")
      .update("PK\u0003\u0004rest")
      .digest("hex");
    expect(attachment.sha256).toBe(expected);
    expect(attachment.expiresAt).toBeUndefined();
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ sha256: expected }),
    );
  });

  it("gives a file of an agent its checksum and its 72 hours", async () => {
    const { service } = setup();
    const staged = await service.stage(
      { conversationId: "conv-1", senderId: "agent-1" },
      {
        name: "daten.sqlite",
        mimeType: "application/vnd.sqlite3",
        source: chunks("SQLite format 3"),
      },
    );
    expect(staged.sha256).toBe(
      createHash("sha256").update("SQLite format 3").digest("hex"),
    );
    expect(staged.expiresAt).toBe("2026-11-17T12:00:00.000Z");
  });

  it("shows no checksum for files stored before", () => {
    expect(toConversationAttachment(stored()).sha256).toBeUndefined();
    expect(
      toConversationAttachment(stored({ sha256: "a".repeat(64) })).sha256,
    ).toBe("a".repeat(64));
  });
});

describe("page count and title of a PDF (PAGE-385)", () => {
  it("keeps a usable page count and a plain title, only for a PDF", () => {
    expect(
      readConversationDocumentFacts("pdf", {
        pageCount: "12",
        title: "  Quartals\u0007bericht \n Q3 ",
      }),
    ).toEqual({
      pageCount: 12,
      title: "Quartals bericht Q3",
    });
    expect(
      readConversationDocumentFacts("pdf", { pageCount: "0", title: "" }),
    ).toBeNull();
    expect(readConversationDocumentFacts("pdf", { pageCount: 3.5 })).toBeNull();
    expect(
      readConversationDocumentFacts("pdf", { title: "x".repeat(400) })?.title,
    ).toHaveLength(300);
    expect(readConversationDocumentFacts("file", { pageCount: 3 })).toBeNull();
  });

  it("shows stored facts to every client", () => {
    expect(conversationDocumentFactsOf({ pageCount: 4, title: null })).toEqual({
      pageCount: 4,
    });
    expect(conversationDocumentFactsOf(null)).toEqual({});
    expect(
      toConversationAttachment(
        stored({ document: { pageCount: 7, title: "Bericht" } }),
      ),
    ).toMatchObject({
      kind: "pdf",
      pageCount: 7,
      documentTitle: "Bericht",
    });
  });

  it("stores what a member's browser read once, and keeps facts stored first", async () => {
    const first = setup();
    await first.service.recordMediaFacts(member, "att-1", {
      pageCount: "7",
      title: "Bericht",
    });
    expect(first.repository.setDocumentFacts).toHaveBeenCalledWith("att-1", {
      pageCount: 7,
      title: "Bericht",
    });
    const second = setup({
      attachment: stored({ document: { pageCount: 2, title: null } }),
    });
    await second.service.recordMediaFacts(member, "att-1", { pageCount: "7" });
    expect(second.repository.setDocumentFacts).not.toHaveBeenCalled();
  });

  it("refuses facts of another kind and answers not_found for people outside the chat", async () => {
    const office = setup({
      attachment: stored({ name: "a.docx", mimeType: "application/zip" }),
    });
    await expect(
      office.service.recordMediaFacts(member, "att-1", { pageCount: 3 }),
    ).rejects.toEqual(new ConversationError("invalid"));
    const outsider = setup({ isMember: false });
    await expect(
      outsider.service.recordMediaFacts(member, "att-1", { pageCount: 3 }),
    ).rejects.toEqual(new ConversationError("not_found"));
    await expect(
      outsider.service.open(member, {
        attachmentId: "att-1",
        variant: "original",
      }),
    ).rejects.toEqual(new ConversationError("not_found"));
  });

  it("serves no document of an agent after its 72 hours", async () => {
    const { service } = setup({
      attachment: stored({ expiresAt: "2026-11-14T11:59:00.000Z" }),
    });
    await expect(
      service.open(member, { attachmentId: "att-1", variant: "original" }),
    ).rejects.toEqual(new ConversationError("not_found"));
  });
});

describe("the document columns of the repository (PAGE-385)", () => {
  const row = [
    "att-1",
    "conv-1",
    "msg-1",
    "agent-1",
    "bericht.pdf",
    "application/pdf",
    3,
    "store-1",
    0,
    null,
    null,
    null,
    "2026-11-14T11:00:00.000Z",
    "2026-11-17T11:00:00.000Z",
    null,
    null,
    null,
    null,
    "b".repeat(64),
    12,
    "Bericht",
  ];

  it("reads checksum, page count and title and stores the facts only once", async () => {
    const { ConversationAttachmentRepository } =
      await import("@/backend/database/repositories/conversation/ConversationAttachmentRepository");
    const query = vi.fn().mockResolvedValue([row]);
    const execute = vi.fn().mockResolvedValue(undefined);
    const repository = new ConversationAttachmentRepository({
      query,
      execute,
      transaction: vi.fn(),
    });
    const found = await repository.find("att-1");
    expect(found?.sha256).toBe("b".repeat(64));
    expect(found?.document).toEqual({ pageCount: 12, title: "Bericht" });
    query.mockResolvedValueOnce([["att-1"]]);
    expect(
      await repository.setDocumentFacts("att-1", {
        pageCount: 12,
        title: null,
      }),
    ).toBe(true);
    expect(String(query.mock.calls[1]?.[0])).toContain(
      "document_pages IS NULL",
    );
    await repository.insert({ ...stored(), sha256: "c".repeat(64) });
    expect(execute.mock.calls[0]?.[1]).toMatchObject({
      sha256: "c".repeat(64),
    });
  });
});
