import { afterEach, describe, expect, it, vi } from "vitest";

import {
  invokePicaNativeTool,
  invokePicaTool,
} from "@/backend/service/chat/acp/PicaToolClient";

vi.mock("@/backend/service/chat/acp/PicaInvocationFile", () => ({
  readPicaInvocationFile: () => ({
    url: "https://example.test",
    authorization: "Bearer token",
  }),
}));

afterEach(() => vi.unstubAllGlobals());

const binding = {
  descriptorFile: "/virtual/descriptor",
  expectedUrl: "https://example.test",
};
const signal = new AbortController().signal;

describe("Pica tool request validation", () => {
  it("validates outgoing requests before making a simulated HTTP call", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
    vi.stubGlobal("fetch", fetch);
    for (const input of [
      "[]",
      "null",
      '{"action":"catalog","extra":1}',
      '{"action":"call","name":"bad space"}',
      '{"action":"native_call","name":"test"}',
    ]) {
      await expect(invokePicaTool(binding, input, signal)).rejects.toThrow(
        "INVALID_REQUEST",
      );
    }
    await expect(
      invokePicaTool(
        binding,
        JSON.stringify({
          action: "call",
          name: "test",
          arguments: "x".repeat(1024 * 1024),
        }),
        signal,
      ),
    ).rejects.toThrow("REQUEST_TOO_LARGE");
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      invokePicaTool(binding, '{"action":"catalog"}', signal),
    ).resolves.toBe('{"ok":true}');
  });

  it("retries only an explicit pending result and rejects other HTTP errors", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"error":"TURN_PENDING"}', { status: 409 }),
      )
      .mockResolvedValueOnce(new Response('{"ok":true}'))
      .mockResolvedValueOnce(new Response('{"error":"other"}', { status: 409 }))
      .mockResolvedValueOnce(new Response("fail", { status: 500 }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      invokePicaTool(binding, '{"action":"catalog"}', signal),
    ).resolves.toBe('{"ok":true}');
    await expect(
      invokePicaTool(binding, '{"action":"catalog"}', signal),
    ).rejects.toThrow("TOOL_HTTP_409");
    await expect(
      invokePicaTool(binding, '{"action":"catalog"}', signal),
    ).rejects.toThrow("TOOL_HTTP_500");
  });

  it("rejects invalid or oversized responses and validates native outcomes", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"images":[]}'))
      .mockResolvedValueOnce(new Response("[]"))
      .mockResolvedValueOnce(new Response("x".repeat(1024 * 1024 + 1)))
      .mockResolvedValueOnce(
        new Response(
          '{"ok":true,"result":"done","error":null,"attachments":[]}',
        ),
      );
    vi.stubGlobal("fetch", fetch);
    for (let index = 0; index < 2; index += 1)
      await expect(
        invokePicaTool(binding, '{"action":"catalog"}', signal),
      ).rejects.toThrow("INVALID_RESPONSE");
    await expect(
      invokePicaTool(binding, '{"action":"catalog"}', signal),
    ).rejects.toThrow("RESPONSE_TOO_LARGE");
    await expect(
      invokePicaNativeTool(binding, { name: "tool", arguments: {} }, signal),
    ).resolves.toEqual({ ok: true, result: "done", error: null });
  });
});
