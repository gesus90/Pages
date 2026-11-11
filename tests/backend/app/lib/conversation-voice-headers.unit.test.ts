import { expect, it } from "vitest";

import { conversationVoiceHeaders } from "@/app/lib/conversation-voice-headers";

it("describes the audio so a player can play it and caches stay private", () => {
  expect(
    conversationVoiceHeaders({ mimeType: "audio/webm", sizeBytes: 2048 }),
  ).toEqual({
    "Cache-Control": "private, no-cache",
    "Content-Length": "2048",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Type": "audio/webm",
    "X-Content-Type-Options": "nosniff",
  });
});

it("sends the mime type and size of each voice message", () => {
  const headers = conversationVoiceHeaders({
    mimeType: "audio/mp4",
    sizeBytes: 0,
  });

  expect(headers["Content-Type"]).toBe("audio/mp4");
  expect(headers["Content-Length"]).toBe("0");
});
