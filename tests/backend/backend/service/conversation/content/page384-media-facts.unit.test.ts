import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { ConversationError } from "@/backend/error/ConversationError";
import {
  ConversationAttachments,
  toConversationAttachment,
} from "@/backend/service/conversation/content/ConversationAttachments";
import {
  conversationMediaFactsOf,
  readConversationMediaFacts,
} from "@/backend/service/conversation/content/ConversationMediaFacts";

import type { StoredConversationAttachment } from "@/backend/database/repositories/conversation/ConversationAttachmentRepository";
import type { ConversationAttachmentsDependencies } from "@/backend/service/conversation/content/ConversationAttachments";
import type { User } from "@/definition/User";

const NOW = new Date("2026-11-14T12:00:00.000Z");
const member = { id: "person-1" } as User;

function stored(overrides: Partial<StoredConversationAttachment> = {}): StoredConversationAttachment {
  return {
    id: "att-1",
    conversationId: "conv-1",
    messageId: "msg-1",
    uploaderId: "agent-1",
    name: "fuchs.mp4",
    mimeType: "video/mp4",
    sizeBytes: 3,
    storageName: "store-1",
    position: 0,
    thumbnail: null,
    createdAt: "2026-11-14T11:00:00.000Z",
    expiresAt: "2026-11-17T11:00:00.000Z",
    expiredAt: null,
    media: null,
    ...overrides,
  };
}

function streamOf(text: string): PassThrough {
  const stream = new PassThrough();
  stream.end(Buffer.from(text));
  return stream;
}

function setup(
  options: { readonly attachment?: StoredConversationAttachment; readonly isMember?: boolean } = {},
): { service: ConversationAttachments; repository: Record<string, ReturnType<typeof vi.fn>> } {
  const attachment = options.attachment ?? stored();
  const repository = {
    insert: vi.fn().mockResolvedValue(undefined),
    find: vi.fn().mockResolvedValue(attachment),
    setMediaFacts: vi.fn().mockResolvedValue(true),
    setThumbnail: vi.fn().mockResolvedValue(true),
    imagesOfConversation: vi.fn().mockResolvedValue([]),
    mediaOfConversation: vi.fn().mockResolvedValue([
      { attachment, messageId: "msg-1", senderId: "agent-1", sentAt: "2026-11-14T11:00:00.000Z" },
    ]),
  };
  const service = new ConversationAttachments({
    attachments: repository as unknown as ConversationAttachmentsDependencies["attachments"],
    conversations: {
      findForMember: vi.fn().mockResolvedValue(options.isMember === false ? null : { id: "conv-1" }),
    },
    files: {
      write: vi.fn().mockResolvedValue({ storageName: "thumb", size: 3 }),
      open: vi.fn(() => streamOf("x")),
      remove: vi.fn().mockResolvedValue(undefined),
      sweep: vi.fn().mockResolvedValue(0),
    } as unknown as ConversationAttachmentsDependencies["files"],
    directory: { read: () => Promise.resolve({ participant: () => ({ name: "Ed" }) }) },
    now: () => NOW,
    createId: () => "att-new",
  });
  return { service, repository };
}

describe("resolution and length of videos and sounds (PAGE-384)", () => {
  it("keeps only usable facts: sizes together and only for a video, a length up to one day", () => {
    expect(readConversationMediaFacts("video", { width: "1920", height: "1080", durationSeconds: "112.4" })).toEqual({
      width: 1920,
      height: 1080,
      durationMs: 112_400,
    });
    expect(readConversationMediaFacts("audio", { width: 10, height: 10, durationSeconds: 41 })).toEqual({
      width: null,
      height: null,
      durationMs: 41_000,
    });
    expect(readConversationMediaFacts("video", { width: 1920 })).toBeNull();
    expect(readConversationMediaFacts("video", { width: 99_999, height: 10, durationSeconds: 90_000 })).toBeNull();
    expect(readConversationMediaFacts("image", { width: 10, height: 10 })).toBeNull();
  });

  it("shows stored facts to every client", () => {
    expect(conversationMediaFactsOf({ width: 1280, height: 720, durationMs: 8000 })).toEqual({
      width: 1280,
      height: 720,
      durationSeconds: 8,
    });
    const attachment = toConversationAttachment(stored({ media: { width: null, height: null, durationMs: 1500 } }));
    expect(attachment).toMatchObject({ kind: "video", durationSeconds: 1.5, expiresAt: "2026-11-17T11:00:00.000Z" });
    expect(attachment.width).toBeUndefined();
  });

  it("stores what a member's browser read once", async () => {
    const { service, repository } = setup();
    await service.recordMediaFacts(member, "att-1", { width: "1920", height: "1080", durationSeconds: "60" });
    expect(repository.setMediaFacts).toHaveBeenCalledWith("att-1", { width: 1920, height: 1080, durationMs: 60_000 });
  });

  it("keeps facts another viewer stored first", async () => {
    const { service, repository } = setup({
      attachment: stored({ media: { width: 640, height: 360, durationMs: 1000 } }),
    });
    await service.recordMediaFacts(member, "att-1", { width: "1920", height: "1080", durationSeconds: "60" });
    expect(repository.setMediaFacts).not.toHaveBeenCalled();
  });

  it("refuses facts of a person who is no member and of an image", async () => {
    const outsider = setup({ isMember: false });
    await expect(outsider.service.recordMediaFacts(member, "att-1", { durationSeconds: "3" })).rejects.toEqual(
      new ConversationError("not_found"),
    );
    expect(outsider.repository.setMediaFacts).not.toHaveBeenCalled();
    const image = setup({ attachment: stored({ mimeType: "image/png" }) });
    await expect(image.service.recordMediaFacts(member, "att-1", { durationSeconds: "3" })).rejects.toEqual(
      new ConversationError("invalid"),
    );
  });

  it("stores the facts of a video with its browser-made preview", async () => {
    const { service, repository } = setup();
    await service.uploadThumbnail(
      member,
      { attachmentId: "att-1", mimeType: "image/webp", facts: { width: "1280", height: "720", durationSeconds: "8" } },
      streamOf("webp"),
    );
    expect(repository.setMediaFacts).toHaveBeenCalledWith("att-1", { width: 1280, height: 720, durationMs: 8000 });
    expect(repository.setThumbnail).toHaveBeenCalled();
  });
});

describe("the videos of a chat (PAGE-384)", () => {
  it("lists the videos of a conversation for a member, with sender and expired state", async () => {
    const { service, repository } = setup({ attachment: stored({ expiresAt: "2026-11-14T11:30:00.000Z" }) });
    const videos = await service.videos(member, "conv-1");
    expect(repository.mediaOfConversation).toHaveBeenCalledWith("conv-1", "video");
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({ senderName: "Ed", messageId: "msg-1" });
    // Its 72 hours ran out before the next expiry run: reported as expired already.
    expect(videos[0]?.attachment.expiredAt).toBe(NOW.toISOString());
  });

  it("answers not_found to a person who is no member", async () => {
    const { service, repository } = setup({ isMember: false });
    await expect(service.videos(member, "conv-1")).rejects.toEqual(new ConversationError("not_found"));
    expect(repository.mediaOfConversation).not.toHaveBeenCalled();
  });

  it("stages a generated video or sound with the 72 hours of every agent file", async () => {
    const { service, repository } = setup();
    const video = await service.stage(
      { conversationId: "conv-1", senderId: "agent-1" },
      { name: "video.mp4", mimeType: "video/mp4", source: streamOf("abc") },
    );
    expect(video.expiresAt).toBe("2026-11-17T12:00:00.000Z");
    expect(repository.insert).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "video/mp4" }));
  });
});

describe("GET /chat/videos/:id (PAGE-384)", () => {
  it("answers the list to a member and 404 to anyone else", async () => {
    const videos = vi.fn();
    vi.doMock("@/app/lib/services.server", () => ({
      getApplicationServices: () => Promise.resolve({ conversationAttachments: { videos } }),
    }));
    const { loader } = await import("@/app/routes/conversation-videos");
    const context = { get: () => member } as unknown as Parameters<typeof loader>[0]["context"];
    videos.mockResolvedValueOnce([{ messageId: "m" }]);
    const response = await loader({ context, params: { id: "conv-1" } } as Parameters<typeof loader>[0]);
    expect(await response.json()).toEqual({ videos: [{ messageId: "m" }] });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    videos.mockRejectedValueOnce(new ConversationError("not_found"));
    await expect(loader({ context, params: { id: "conv-1" } } as Parameters<typeof loader>[0])).rejects.toMatchObject({
      status: 404,
    });
    const anonymous = { get: () => null } as unknown as Parameters<typeof loader>[0]["context"];
    await expect(loader({ context: anonymous, params: { id: "conv-1" } } as Parameters<typeof loader>[0])).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe("the stored facts and videos of the repository (PAGE-384)", () => {
  const row = [
    "att-1", "conv-1", "msg-1", "agent-1", "fuchs.mp4", "video/mp4", 3, "store-1", 0,
    null, null, null, "2026-11-14T11:00:00.000Z", "2026-11-17T11:00:00.000Z", null,
    1920, 1080, 8000, "agent-1", "2026-11-14T11:00:00.000Z",
  ];

  it("reads resolution and length after the expiry columns and the sender after them", async () => {
    const { ConversationAttachmentRepository } = await import(
      "@/backend/database/repositories/conversation/ConversationAttachmentRepository"
    );
    const query = vi.fn().mockResolvedValue([row]);
    const repository = new ConversationAttachmentRepository({
      query,
      execute: vi.fn(),
      transaction: vi.fn(),
    } as unknown as ConstructorParameters<typeof ConversationAttachmentRepository>[0]);
    const [video] = await repository.mediaOfConversation("conv-1", "video");
    expect(video?.attachment.media).toEqual({ width: 1920, height: 1080, durationMs: 8000 });
    expect(video?.senderId).toBe("agent-1");
    expect(query.mock.calls[0]?.[1]).toEqual({ conversation_id: "conv-1", type_pattern: "video/%" });
    query.mockResolvedValueOnce([["att-1"]]);
    expect(await repository.setMediaFacts("att-1", { width: 1, height: 2, durationMs: 3 })).toBe(true);
    expect(String(query.mock.calls[1]?.[0])).toContain("media_duration_ms IS NULL");
  });
});
