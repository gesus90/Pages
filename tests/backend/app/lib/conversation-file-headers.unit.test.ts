import { describe, expect, it } from "vitest";

import {
  conversationFileHead,
  readByteRange,
} from "@/app/lib/conversation-file-headers";

describe("conversation file byte ranges", () => {
  it.each([
    ["bytes=2-5", 10, { start: 2, end: 5 }],
    [" bytes=8-99 ", 10, { start: 8, end: 9 }],
    ["bytes=3-", 10, { start: 3, end: 9 }],
    ["bytes=-3", 10, { start: 7, end: 9 }],
    ["bytes=-99", 10, { start: 0, end: 9 }],
    ["bytes=-0", 10, null],
    ["bytes=-", 10, null],
    ["bytes=10-", 10, null],
    ["bytes=5-2", 10, null],
    ["bytes=0-1,3-4", 10, null],
    ["items=0-1", 10, null],
    [null, 10, null],
    ["bytes=0-1", 0, null],
  ])("parses %s for size %i", (header, size, expected) => {
    expect(readByteRange(header, size)).toEqual(expected);
  });
});

describe("conversation file response headers", () => {
  it("protects inline content and describes a partial response", () => {
    const result = conversationFileHead(
      {
        name: "Bild.png",
        mimeType: "image/png",
        sizeBytes: 10,
        range: { start: 2, end: 5 },
      },
      false,
    );
    expect(result.status).toBe(206);
    expect(result.headers).toEqual({
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-cache",
      "Content-Disposition":
        "inline; filename=\"Bild.png\"; filename*=UTF-8''Bild.png",
      "Content-Length": "4",
      "Content-Range": "bytes 2-5/10",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": "image/png",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    });
  });

  it.each([
    ["image/png", true],
    ["text/html", false],
  ])(
    "downloads %s when requested or unsafe to display",
    (mimeType, isDownload) => {
      const result = conversationFileHead(
        { name: "file", mimeType, sizeBytes: 12, range: null },
        isDownload,
      );
      expect(result.status).toBe(200);
      expect(result.headers["Content-Disposition"]).toMatch(/^attachment;/u);
      expect(result.headers["Content-Length"]).toBe("12");
      expect(result.headers["Content-Range"]).toBeUndefined();
    },
  );
});
