import { beforeEach, expect, it, vi } from "vitest";

import {
  chatFailure,
  readChatJson,
  requireChatRequest,
} from "@/app/lib/chat-response.server";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { ChatError } from "@/backend/error/ChatErrors";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(logCaughtError).mockClear();
  vi.mocked(logDiagnostic).mockClear();
});

const URL_OF_CHAT = "http://pages.invalid/chat";

function chatCode(work: () => unknown): string {
  try {
    work();
  } catch (error: unknown) {
    if (error instanceof ChatError) return error.code;
    throw error;
  }
  throw new Error("Expected a chat error.");
}

async function rejectedChatCode(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error: unknown) {
    if (error instanceof ChatError) return error.code;
    throw error;
  }
  throw new Error("Expected a chat error.");
}

function post(body: string): Request {
  return new Request(URL_OF_CHAT, { method: "POST", body });
}

it("accepts the expected method from the own or an unnamed origin", () => {
  expect(() => {
    requireChatRequest(new Request(URL_OF_CHAT, { method: "POST" }), "POST");
  }).not.toThrow();
  expect(() => {
    requireChatRequest(
      new Request(URL_OF_CHAT, {
        method: "POST",
        headers: { Origin: "http://pages.invalid" },
      }),
      "POST",
    );
  }).not.toThrow();
});

it("refuses another method and a foreign origin", () => {
  expect(
    chatCode(() => requireChatRequest(new Request(URL_OF_CHAT), "POST")),
  ).toBe("invalidInput");
  expect(
    chatCode(() =>
      requireChatRequest(
        new Request(URL_OF_CHAT, {
          method: "POST",
          headers: { Origin: "http://evil.invalid" },
        }),
        "POST",
      ),
    ),
  ).toBe("accessDenied");
});

it("reads a JSON object and treats other JSON as an empty object", async () => {
  await expect(readChatJson(post('{"message":"hi"}'))).resolves.toEqual({
    message: "hi",
  });
  await expect(readChatJson(post("[1,2]"))).resolves.toEqual({});
});

it("refuses an oversized body before parsing it", async () => {
  await expect(
    rejectedChatCode(readChatJson(post(" ".repeat(100_001)))),
  ).resolves.toBe("invalidInput");
  expect(logCaughtError).not.toHaveBeenCalled();
});

it("refuses malformed JSON and records the parser failure", async () => {
  await expect(rejectedChatCode(readChatJson(post("{")))).resolves.toBe(
    "invalidInput",
  );
  expect(logCaughtError).toHaveBeenCalledWith(
    "chat_response",
    expect.any(SyntaxError),
  );
});

it("maps chat and execution failures to their stable status", async () => {
  const busy = chatFailure(new ChatError("messageAlreadySent"));
  const unmapped = chatFailure(new ChatError("emptyMessage"));
  const timeout = chatFailure(new AgentExecutionError("timeout"));

  expect(busy.status).toBe(409);
  expect(busy.headers.get("Cache-Control")).toBe("no-store");
  expect(await busy.json()).toEqual({ ok: false, error: "messageAlreadySent" });
  expect(unmapped.status).toBe(400);
  expect(timeout.status).toBe(504);
  expect(await timeout.json()).toEqual({ ok: false, error: "timeout" });
  expect(logDiagnostic).not.toHaveBeenCalled();
});

it("hides an unexpected failure behind a logged general error", async () => {
  const failure = new Error("provider said something private");

  const response = chatFailure(failure);

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ ok: false, error: "general" });
  expect(logDiagnostic).toHaveBeenCalledWith(
    "chat_response",
    "error",
    "[pages] A chat request failed.",
    failure,
  );
});
