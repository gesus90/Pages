import { expect, it, vi } from "vitest";

import {
  ACP_STEERING_METHOD,
  isAcpSteeringSupported,
  readAcpSteerOutcome,
  requestAcpSteer,
} from "@/backend/agents/acp/AcpChat";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const PROMPT = [{ type: "text" as const, text: "hi" }];

it("sends a steer with meta", async () => {
  const request = vi.fn().mockResolvedValue({ outcome: "injected" });
  const result = await requestAcpSteer(
    { request },
    { sessionId: "s", prompt: PROMPT, meta: { a: 1 } },
  );
  expect(result).toBe("injected");
  expect(request).toHaveBeenCalledWith(ACP_STEERING_METHOD, {
    sessionId: "s",
    prompt: PROMPT,
    _meta: { a: 1 },
  });
});

it("sends a steer without meta", async () => {
  const request = vi.fn().mockResolvedValue({ outcome: "promptRequired" });
  await requestAcpSteer(
    { request },
    { sessionId: "s", prompt: PROMPT, meta: null },
  );
  expect(request).toHaveBeenCalledWith(ACP_STEERING_METHOD, {
    sessionId: "s",
    prompt: PROMPT,
  });
});

it("reports a refused steer as failed", async () => {
  const request = vi.fn().mockRejectedValue(new Error("x"));
  expect(
    await requestAcpSteer(
      { request },
      { sessionId: "s", prompt: PROMPT, meta: null },
    ),
  ).toBe("failed");
});

it.each([
  [null, "failed"],
  ["x", "failed"],
  [{ outcome: "other" }, "failed"],
  [{ outcome: "injected" }, "injected"],
  [{ outcome: "startedNewTurn" }, "startedNewTurn"],
  [{ outcome: "promptRequired" }, "promptRequired"],
])("reads steer outcome %#", (response, expected) => {
  expect(readAcpSteerOutcome(response)).toBe(expected);
});

it.each([
  [null, false],
  ["x", false],
  [{}, false],
  [{ steering: null }, false],
  [{ steering: { supported: false } }, false],
  [{ steering: { supported: true } }, true],
])("reads steering support %#", (meta, expected) => {
  expect(isAcpSteeringSupported(meta)).toBe(expected);
});
