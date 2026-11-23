import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  cancelAcpTurn,
  closeAcpProtocol,
} from "@/backend/agents/acp/AcpProtocolClose";
import { logCaughtError } from "@/backend/logging/Logger";

import type { ClientConnection } from "@agentclientprotocol/sdk";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

function connection(
  agent: Record<string, unknown>,
  aborted = false,
): ClientConnection {
  return {
    signal: { aborted },
    agent,
  } as unknown as ClientConnection;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(logCaughtError).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

it("skips closing without a session or on an aborted connection", async () => {
  const request = vi.fn();
  await closeAcpProtocol(connection({ request }), null);
  await closeAcpProtocol(connection({ request }, true), "s");
  expect(request).not.toHaveBeenCalled();
});

it("closes the session", async () => {
  const request = vi.fn().mockResolvedValue({});
  await closeAcpProtocol(connection({ request }), "s");
  expect(request).toHaveBeenCalledWith("session/close", { sessionId: "s" });
});

it("stops waiting after five seconds", async () => {
  const request = vi.fn(() => new Promise(() => undefined));
  const done = closeAcpProtocol(connection({ request }), "s");
  await vi.advanceTimersByTimeAsync(5_000);
  await done;
  expect(logCaughtError).not.toHaveBeenCalled();
});

it("logs a failed close", async () => {
  const request = vi.fn().mockRejectedValue(new Error("x"));
  await closeAcpProtocol(connection({ request }), "s");
  expect(logCaughtError).toHaveBeenCalled();
});

it("does not cancel without a session", async () => {
  const notify = vi.fn();
  await cancelAcpTurn(connection({ notify }), null, []);
  expect(notify).not.toHaveBeenCalled();
});

it("sends a cancellation", async () => {
  const notify = vi.fn().mockResolvedValue(undefined);
  await cancelAcpTurn(connection({ notify }), "s", []);
  expect(notify).toHaveBeenCalledWith("session/cancel", { sessionId: "s" });
});

it.each([
  [new Error("boom"), "cancel boom"],
  ["text", "cancel failed"],
])("records a failed cancellation %#", async (error, note) => {
  const events: string[] = [];
  const notify = vi.fn().mockRejectedValue(error);
  await cancelAcpTurn(connection({ notify }), "s", events);
  expect(events.join("\n")).toContain(note);
});
