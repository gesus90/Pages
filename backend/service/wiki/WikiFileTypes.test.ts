import { expect, it } from "vitest";

import {
  detectFileType,
  GENERIC_CONTENT_TYPE,
  isEmbeddableType,
  sanitizeFileName,
} from "./WikiFileTypes";

function head(...parts: (number[] | string)[]): Buffer {
  const bytes = Buffer.alloc(16);
  let offset = 0;

  for (const part of parts) {
    const chunk = typeof part === "string" ? Buffer.from(part, "latin1") : part;

    Buffer.from(chunk).copy(bytes, offset);
    offset += chunk.length;
  }

  return bytes;
}

function riff(form: string): Buffer {
  return head("RIFF", [0, 0, 0, 0], form);
}

it.each([
  ["image/jpeg", head([0xff, 0xd8, 0xff]), true],
  ["image/png", head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), true],
  ["image/gif", head("GIF87a"), true],
  ["image/gif", head("GIF89a"), true],
  ["image/webp", riff("WEBP"), true],
  ["audio/wav", riff("WAVE"), false],
  ["video/x-msvideo", riff("AVI "), false],
  ["audio/ogg", head("OggS"), false],
  ["audio/flac", head("fLaC"), false],
  ["audio/mpeg", head("ID3"), false],
  ["audio/mpeg", head([0xff, 0xfb]), false],
  ["video/webm", head([0x1a, 0x45, 0xdf, 0xa3]), false],
  ["video/mp4", head([0, 0, 0, 0], "ftyp"), false],
])("detects %s by its content", (contentType, bytes, isEmbeddable) => {
  expect(detectFileType(bytes)).toEqual({
    contentType,
    isEmbeddable,
    kind: "media",
  });
});

it("treats unknown content as a plain file", () => {
  expect(detectFileType(Buffer.alloc(0))).toEqual({
    contentType: GENERIC_CONTENT_TYPE,
    isEmbeddable: false,
    kind: "file",
  });
  expect(detectFileType(Buffer.from([0xff, 0x00])).kind).toBe("file");
  expect(detectFileType(Buffer.from([0xff])).kind).toBe("file");
});

it("embeds only raster images of the media kind", () => {
  expect(isEmbeddableType("image/png", "media")).toBe(true);
  expect(isEmbeddableType("image/png", "file")).toBe(false);
  expect(isEmbeddableType("audio/ogg", "media")).toBe(false);
});

it("cleans file names", () => {
  expect(sanitizeFileName("C:\\dir/..\\a:b  c?.txt")).toBe("a_b c_.txt");
  expect(sanitizeFileName("..hidden")).toBe("hidden");
  expect(sanitizeFileName("dir/")).toBe("file");
  expect(sanitizeFileName("")).toBe("file");
});
