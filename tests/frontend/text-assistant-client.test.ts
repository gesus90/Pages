import { describe, expect, it, vi } from "vitest";

import {
  assistantApi,
  assistantErrorCode,
  AssistantClientError,
  readAssistantResult,
  readAssistantConversations,
  readAssistantMessages,
} from "@/app/lib/text-assistant-client";

const result = {
  requestId: "r",
  conversationId: "c",
  text: "Text",
  change: "answer",
  context: { kind: "wiki", id: "p", version: "1" },
};
const message = {
  id: "m",
  text: "Text",
  createdAt: "now",
  role: "user",
  change: "answer",
};

describe("assistant browser transport contracts", () => {
  it("posts only explicit input and maps safe failure envelopes", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", request);
    const signal = new AbortController().signal;
    expect(await assistantApi({ intent: "history" }, signal)).toEqual({
      ok: true,
    });
    expect(request).toHaveBeenCalledWith(
      "/assistant-api",
      expect.objectContaining({
        method: "POST",
        body: '{"intent":"history"}',
        signal,
      }),
    );
    for (const payload of [
      { ok: false, error: "versionConflict" },
      { ok: false },
      null,
    ]) {
      request.mockResolvedValueOnce(Response.json(payload, { status: 409 }));
      await expect(assistantApi({ intent: "validate" })).rejects.toThrow(
        payload?.error ?? "providerFailed",
      );
    }
    request.mockResolvedValueOnce(Response.json({ ok: false }));
    await expect(assistantApi({})).rejects.toThrow("providerFailed");
    expect(assistantErrorCode(new AssistantClientError("cancelled"))).toBe(
      "cancelled",
    );
    expect(assistantErrorCode(new Error("private network message"))).toBe(
      "providerFailed",
    );
  });

  it("reads complete results and rejects every malformed result field", () => {
    expect(readAssistantResult(result)).toEqual(result);
    for (const change of ["answer", "replace", "insert"])
      expect(
        readAssistantResult({
          ...result,
          change,
          context: { kind: "ticket", id: "t", version: "" },
        }).change,
      ).toBe(change);
    for (const field of ["requestId", "conversationId", "text", "change"])
      expect(() => readAssistantResult({ ...result, [field]: 1 })).toThrow(
        "invalidOutput",
      );
    for (const field of ["kind", "id", "version"])
      expect(() =>
        readAssistantResult({
          ...result,
          context: { ...result.context, [field]: 1 },
        }),
      ).toThrow("invalidOutput");
    expect(() => readAssistantResult(null)).toThrow("invalidOutput");
  });

  it("reads histories without silently skipping malformed entries", () => {
    expect(
      readAssistantConversations([{ id: "c", lastMessageAt: "now" }]),
    ).toEqual([{ id: "c", lastMessageAt: "now" }]);
    for (const input of [null, [{}], [{ id: "c", lastMessageAt: 1 }]])
      expect(() => readAssistantConversations(input)).toThrow("invalidOutput");
    expect(
      readAssistantMessages([
        message,
        { ...message, role: "assistant", change: "replace" },
        { ...message, change: "insert" },
      ]),
    ).toHaveLength(3);
    expect(() => readAssistantMessages(null)).toThrow("invalidOutput");
    for (const field of ["id", "text", "createdAt", "role", "change"])
      expect(() => readAssistantMessages([{ ...message, [field]: 1 }])).toThrow(
        "invalidOutput",
      );
  });
});
