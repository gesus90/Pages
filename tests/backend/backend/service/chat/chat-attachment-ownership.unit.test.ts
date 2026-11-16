import { Readable } from "node:stream";

import { expect, it, vi } from "vitest";

import { ChatAttachmentService } from "@/backend/service/chat/ChatAttachmentService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { StoredChatAttachment } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import type { ChatAttachmentDependencies } from "@/backend/service/chat/ChatAttachmentService";
import type { User } from "@/definition/User";

const ACTOR = partial<User>({
  id: "user",
  isActive: true,
  mustChangePassword: false,
});
const FILE = partial<StoredChatAttachment>({
  id: "file",
  storageName: "private",
  contentType: "text/plain",
  fileName: "file.txt",
  size: 5,
  messageId: null,
  origin: "user",
});

it("selects only unsent user uploads from the same session", async () => {
  const list = vi.fn(async () => [
    FILE,
    { ...FILE, id: "sent", messageId: "message" },
    { ...FILE, id: "assistant", origin: "assistant" },
  ]);
  const service = new ChatAttachmentService(
    partial<ChatAttachmentDependencies>({ attachments: { list } }),
  );
  await expect(service.pending("session", ["file", "file"])).resolves.toEqual([
    FILE,
  ]);
  await expect(service.pending("session", ["sent"])).rejects.toMatchObject({
    code: "attachmentMissing",
  });
  await expect(service.pending("session", ["bad id"])).rejects.toMatchObject({
    code: "invalidInput",
  });
  expect(list).toHaveBeenCalledWith("session");
});

it("requires ownership before opening or removing unsent files", async () => {
  const find = vi.fn(async () => FILE);
  const removeUnsent = vi.fn(async () => "private");
  const remove = vi.fn(async () => {});
  const open = vi.fn(() => Readable.from([Buffer.from("hello")]));
  const service = new ChatAttachmentService(
    partial<ChatAttachmentDependencies>({
      attachments: { find, removeUnsent },
      files: { open, remove },
    }),
  );
  const result = await service.open(ACTOR, "file");
  expect(result.attachment).toEqual({
    id: "file",
    fileName: "file.txt",
    contentType: "text/plain",
    size: 5,
  });
  expect(find).toHaveBeenCalledWith("user", "file");
  await expect(service.openImage(ACTOR, "file")).rejects.toMatchObject({
    code: "attachmentMissing",
  });
  await service.discard(ACTOR, "file");
  expect(removeUnsent).toHaveBeenCalledWith("user", "file");
  expect(remove).toHaveBeenCalledWith(["private"]);
  await expect(
    service.discard({ ...ACTOR, isActive: false }, "file"),
  ).rejects.toMatchObject({ code: "accessDenied" });
});

it("bounds decoded text and binary reads even when a stream exceeds its recorded size", async () => {
  const open = vi.fn(() => Readable.from([Buffer.from("hello😀")]));
  const service = new ChatAttachmentService(
    partial<ChatAttachmentDependencies>({ files: { open } }),
  );
  await expect(service.readText(FILE, 6)).resolves.toBe("hello😀");
  await expect(service.readBytes(FILE, 4)).resolves.toBeNull();
  await expect(service.readBytes(FILE, 6)).resolves.toBeNull();
  await expect(service.readBytes(FILE, 20)).resolves.toEqual(
    Buffer.from("hello😀"),
  );
});
