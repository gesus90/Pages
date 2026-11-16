import { expect, it } from "vitest";

import { readChatAttachmentPreview } from "@/backend/service/chat/ChatAttachmentPreviews";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { StoredChatAttachment } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import type { ChatAttachmentReader } from "@/backend/service/chat/ChatAttachmentContent";

it("renders CSV quotes, embedded delimiters and line breaks as a table", async () => {
  const attachment = partial<StoredChatAttachment>({ contentType: "text/csv" });
  const reader = partial<ChatAttachmentReader>({
    readText: async () => 'name;note\n"Ada";"one; two"\n"Grace";"line\nnext"',
  });
  await expect(readChatAttachmentPreview(attachment, reader)).resolves.toEqual({
    kind: "table",
    sheet: null,
    rows: [
      ["name", "note"],
      ["Ada", "one; two"],
      ["Grace", "line\nnext"],
    ],
    isTruncated: false,
  });
});

it("pretty prints JSON and bounds long plain text", async () => {
  const json = partial<StoredChatAttachment>({
    contentType: "application/json",
  });
  await expect(
    readChatAttachmentPreview(
      json,
      partial<ChatAttachmentReader>({ readText: async () => '{"ok":true}' }),
    ),
  ).resolves.toEqual({
    kind: "text",
    text: '{\n  "ok": true\n}',
    isTruncated: false,
  });
  const text = partial<StoredChatAttachment>({ contentType: "text/plain" });
  const result = await readChatAttachmentPreview(
    text,
    partial<ChatAttachmentReader>({ readText: async () => "a".repeat(20_001) }),
  );
  expect(result).toMatchObject({ kind: "text", isTruncated: true });
  if (result.kind !== "text") throw new Error("Expected text preview");
  expect(result.text).toHaveLength(20_000);
});

it("reports unsupported, oversized and unreadable attachments", async () => {
  const reader = partial<ChatAttachmentReader>({
    readBytes: async () => null,
    readText: async () => {
      throw new Error("unavailable");
    },
  });
  await expect(
    readChatAttachmentPreview(
      partial<StoredChatAttachment>({ contentType: "image/png" }),
      reader,
    ),
  ).resolves.toEqual({ kind: "unavailable", reason: "unsupported" });
  await expect(
    readChatAttachmentPreview(
      partial<StoredChatAttachment>({ contentType: "application/pdf" }),
      reader,
    ),
  ).resolves.toEqual({ kind: "unavailable", reason: "tooLarge" });
  await expect(
    readChatAttachmentPreview(
      partial<StoredChatAttachment>({ contentType: "text/plain" }),
      reader,
    ),
  ).resolves.toEqual({ kind: "unavailable", reason: "unreadable" });
});
