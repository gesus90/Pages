import { writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { inflateSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

import { encodePdfImagePng } from "@/backend/service/chat/ChatPdfImages";
import { ConversationMessageContent } from "@/backend/service/conversation/content/ConversationMessageContent";
import {
  FfmpegVideoFrameReader,
  frameMoments,
} from "@/backend/service/conversation/content/ConversationVideoFrames";

import type { StoredConversationMessage } from "@/backend/database/repositories/conversation/ConversationMessageRepository";

describe("PAGE-386 PNG of a decoded PDF image", () => {
  it("encodes RGB pixels as a valid PNG with RGBA rows", () => {
    const png = encodePdfImagePng({
      width: 2,
      height: 1,
      kind: 2,
      data: new Uint8Array([255, 0, 0, 0, 0, 255]),
    });
    expect(png?.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(png?.readUInt32BE(16)).toBe(2);
    expect(png?.readUInt32BE(20)).toBe(1);
    const dataStart = (png?.indexOf("IDAT") ?? 0) + 4;
    const length = png?.readUInt32BE(dataStart - 8) ?? 0;
    const raw = inflateSync(
      png?.subarray(dataStart, dataStart + length) ?? Buffer.alloc(0),
    );
    expect([...raw]).toEqual([0, 255, 0, 0, 255, 0, 0, 255, 255]);
  });

  it("reads one-bit pixels and refuses unknown layouts", () => {
    const png = encodePdfImagePng({
      width: 2,
      height: 1,
      kind: 1,
      data: new Uint8Array([0b10000000]),
    });
    const dataStart = (png?.indexOf("IDAT") ?? 0) + 4;
    const length = png?.readUInt32BE(dataStart - 8) ?? 0;
    expect([
      ...inflateSync(
        png?.subarray(dataStart, dataStart + length) ?? Buffer.alloc(0),
      ),
    ]).toEqual([0, 255, 255, 255, 255, 0, 0, 0, 255]);
    expect(
      encodePdfImagePng({
        width: 1,
        height: 1,
        kind: 9,
        data: new Uint8Array(4),
      }),
    ).toBeNull();
  });
});

describe("PAGE-386 stills of a video", () => {
  it("spreads the stills evenly without the first and last frame", () => {
    expect(frameMoments(50, 4)).toEqual([10, 20, 30, 40]);
    expect(frameMoments(0, 4)).toEqual([0]);
  });

  it("runs ffmpeg with fixed arguments and reads its stills", async () => {
    const run = vi.fn(async (program: string, args: readonly string[]) => {
      if (program === "ffprobe") return "20.0\n";
      await writeFile(String(args.at(-1)), "jpeg");
      return "";
    });
    const reader = new FfmpegVideoFrameReader(run);
    const frames = await reader.frames(
      () => Readable.from([Buffer.from("video")]),
      null,
    );
    expect(frames).toHaveLength(4);
    expect(frames?.[0]?.toString()).toBe("jpeg");
    expect(run).toHaveBeenCalledWith(
      "ffprobe",
      expect.arrayContaining(["format=duration"]),
    );
    expect(run).toHaveBeenCalledWith(
      "ffmpeg",
      expect.arrayContaining(["-ss", "4.000", "-frames:v", "1"]),
    );
  });

  it("answers null when the server has no ffmpeg", async () => {
    const reader = new FfmpegVideoFrameReader(() =>
      Promise.reject(
        Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" }),
      ),
    );
    await expect(
      reader.frames(() => Readable.from([Buffer.from("v")]), 10),
    ).resolves.toBeNull();
  });
});

describe("PAGE-386 references in the content of messages", () => {
  it("adds the references of a message and leaves messages without any unchanged", async () => {
    const base: StoredConversationMessage = {
      id: "answer",
      sequence: 2,
      conversationId: "group",
      senderId: "mei",
      clientMessageId: "c",
      text: "siehe",
      mentions: [],
      createdAt: "2026-11-15",
      voice: null,
      notice: null,
    };
    const reference = {
      attachmentId: "t",
      state: "available" as const,
      name: "t.csv",
      sourceMessageId: "m",
      senderName: "Conan",
    };
    const references = {
      forMessages: vi
        .fn()
        .mockResolvedValue(new Map([["answer", [reference]]])),
    };
    const content = new ConversationMessageContent(
      { forMessages: vi.fn().mockResolvedValue(new Map()) },
      { forMessages: vi.fn().mockResolvedValue(new Map()) },
      references,
    );
    const described = await content.describe([base, { ...base, id: "other" }]);
    expect(described.get("answer")).toEqual({
      attachments: [],
      links: [],
      references: [reference],
    });
    expect(described.get("other")).toEqual({ attachments: [], links: [] });
    expect(references.forMessages).toHaveBeenCalledWith(["answer", "other"]);
  });
});
