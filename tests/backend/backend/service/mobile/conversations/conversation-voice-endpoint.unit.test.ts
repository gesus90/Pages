import { describe, expect, it, vi } from "vitest";

import { PicaMobileConversationFiles } from "@/backend/service/mobile/conversations/PicaMobileConversationFiles";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { IncomingMessage, ServerResponse } from "node:http";
import type { PicaMobileAuthenticator } from "@/backend/service/mobile/PicaMobileAuthenticator";
import type { PicaMobileConversationsProvider } from "@/backend/service/mobile/conversations/PicaMobileConversationsProvider";

function fixture(): {
  files: PicaMobileConversationFiles;
  openVoice: ReturnType<typeof vi.fn>;
  authenticate: ReturnType<typeof vi.fn>;
} {
  const authenticate = vi
    .fn()
    .mockResolvedValue({ ok: true, user: { id: "u" } });
  const openVoice = vi.fn();
  return {
    files: new PicaMobileConversationFiles({
      authenticator: partial<PicaMobileAuthenticator>({ authenticate }),
      conversations: partial<PicaMobileConversationsProvider>({ openVoice }),
    }),
    openVoice,
    authenticate,
  };
}

function response(): ServerResponse {
  return partial<ServerResponse>({
    writeHead: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
    headersSent: false,
  });
}

function request(
  url = "/pica-mobile/conversations/voice/message",
  method = "GET",
): IncomingMessage {
  return partial<IncomingMessage>({
    url,
    method,
    headers: { authorization: "Bearer token" },
  });
}

describe("mobile conversation voice endpoint", () => {
  it("recognizes only valid GET voice paths", () => {
    const { files } = fixture();
    expect(files.handle(request("/other"), response(), null)).toBe(false);
    expect(
      files.handle(
        request("/pica-mobile/conversations/voice/bad%20id"),
        response(),
        null,
      ),
    ).toBe(false);
    expect(files.handle(request(undefined, "POST"), response(), null)).toBe(
      false,
    );
  });

  it("returns authorization and missing-file outcomes", async () => {
    const { files, openVoice, authenticate } = fixture();
    authenticate.mockResolvedValueOnce({ ok: false });
    const denied = response();
    expect(files.handle(request(), denied, null)).toBe(true);
    await vi.waitFor(() =>
      expect(denied.writeHead).toHaveBeenCalledWith(401, expect.any(Object)),
    );
    openVoice
      .mockResolvedValueOnce({ kind: "notFound" })
      .mockResolvedValueOnce({ kind: "sessionEnded" });
    const missing = response();
    files.handle(request(), missing, null);
    await vi.waitFor(() =>
      expect(missing.writeHead).toHaveBeenCalledWith(404, expect.any(Object)),
    );
    const ended = response();
    files.handle(request(), ended, null);
    await vi.waitFor(() =>
      expect(ended.writeHead).toHaveBeenCalledWith(401, expect.any(Object)),
    );
  });

  it("maps unexpected errors to a general response", async () => {
    const { files, openVoice } = fixture();
    openVoice.mockRejectedValue(new Error("storage"));
    const result = response();
    files.handle(request(), result, null);
    await vi.waitFor(() =>
      expect(result.writeHead).toHaveBeenCalledWith(500, expect.any(Object)),
    );
  });
});
