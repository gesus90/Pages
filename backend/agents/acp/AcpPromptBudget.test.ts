import { beforeEach, expect, it, vi } from "vitest";

import {
  ACP_MESSAGE_BUDGET_BYTES,
  acpBlockBytes,
  acpMessageBytes,
  acpPromptParams,
  acpPromptRoom,
  isAcpMessageWithinBudget,
  requireAcpMessageBudget,
} from "@/backend/agents/acp/AcpPromptBudget";
import { AgentError } from "@/backend/error/AgentErrors";
import { logEvent } from "@/backend/logging/Logger";

vi.mock("@/backend/logging/Logger", () => ({ logEvent: vi.fn() }));

const OWNER = { sessionId: "s", provider: "p" };
const SMALL = { method: "m", params: { a: 1 } };
const HUGE = {
  method: "m",
  params: { a: "x".repeat(ACP_MESSAGE_BUDGET_BYTES) },
};

beforeEach(() => {
  vi.mocked(logEvent).mockClear();
});

it("measures messages and blocks", () => {
  expect(acpMessageBytes(SMALL)).toBeGreaterThan(20);
  expect(acpBlockBytes({ type: "text", text: "é" })).toBe(
    Buffer.byteLength('{"type":"text","text":"é"}') + 1,
  );
});

it("computes the remaining room", () => {
  expect(acpPromptRoom(SMALL)).toBe(
    ACP_MESSAGE_BUDGET_BYTES - acpMessageBytes(SMALL),
  );
  expect(acpPromptRoom(HUGE)).toBeLessThan(0);
});

it("accepts a message within budget", () => {
  expect(isAcpMessageWithinBudget(SMALL, OWNER)).toBe(true);
  expect(logEvent).not.toHaveBeenCalled();
});

it("logs and refuses an oversized message", () => {
  expect(isAcpMessageWithinBudget(HUGE, OWNER)).toBe(false);
  expect(logEvent).toHaveBeenCalledOnce();
  expect(() => requireAcpMessageBudget(HUGE, OWNER)).toThrow(AgentError);
  expect(() => requireAcpMessageBudget(SMALL, OWNER)).not.toThrow();
});

it("builds prompt params within budget", () => {
  const prompt = [{ type: "text" as const, text: "x" }];
  expect(acpPromptParams("s", prompt, "p")).toEqual({ sessionId: "s", prompt });
  expect(() =>
    acpPromptParams(
      "s",
      [{ type: "text", text: "x".repeat(ACP_MESSAGE_BUDGET_BYTES) }],
      "p",
    ),
  ).toThrow(AgentError);
});
