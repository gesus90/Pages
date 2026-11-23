import { beforeEach, expect, it, vi } from "vitest";

import { decideAcpSessionPermission } from "@/backend/agents/acp/AcpSessionPermission";
import { createAcpSessionState } from "@/backend/agents/acp/AcpEvents";
import { logEvent } from "@/backend/logging/Logger";

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import type { AcpSessionContext } from "@/backend/agents/acp/AcpSessionContracts";

vi.mock("@/backend/logging/Logger", () => ({ logEvent: vi.fn() }));

type Context = Pick<AcpSessionContext, "listener" | "profile" | "picaSupport">;

const OUTCOME = { outcome: "cancelled" } as const;

function request(title?: string, kind?: "read"): RequestPermissionRequest {
  return {
    sessionId: "s",
    toolCall: { toolCallId: "t", title, kind },
    options: [],
  };
}

function context(overrides: Record<string, unknown>): Context {
  return {
    listener: undefined,
    picaSupport: undefined,
    profile: {
      mode: "readonly",
      decide: () => ({ outcome: OUTCOME, isDenied: false }),
    },
    ...overrides,
  } as unknown as Context;
}

beforeEach(() => {
  vi.mocked(logEvent).mockClear();
});

it("keeps the decision of the profile without a helper", () => {
  const state = createAcpSessionState();
  expect(decideAcpSessionPermission(context({}), state, request())).toEqual({
    outcome: OUTCOME,
  });
  expect(state.permissionDenials).toBe(0);
});

it("keeps the decision of the profile in yolo mode", () => {
  const decide = vi.fn(() => ({ outcome: OUTCOME, isDenied: false }));
  const ctx = context({
    listener: { picaHelper: () => "/h" },
    profile: { mode: "yolo", decide },
  });
  decideAcpSessionPermission(ctx, createAcpSessionState(), request());
  expect(decide).toHaveBeenCalled();
});

it("fails when helper support is missing", () => {
  const ctx = context({ listener: { picaHelper: () => "/h" } });
  expect(() =>
    decideAcpSessionPermission(ctx, createAcpSessionState(), request()),
  ).toThrow("Pica permission support is missing");
});

it.each([
  ["Title", undefined, "refused Title"],
  [undefined, "read" as const, "refused read"],
  [undefined, undefined, "refused request"],
])("counts and notes a denial (%s, %s)", (title, kind, note) => {
  const state = createAcpSessionState();
  const ctx = context({
    listener: { picaHelper: () => "/h" },
    picaSupport: {
      decideHelperPermission: () => ({ outcome: OUTCOME, isDenied: true }),
    },
  });
  expect(decideAcpSessionPermission(ctx, state, request(title, kind))).toEqual({
    outcome: OUTCOME,
  });
  expect(state.permissionDenials).toBe(1);
  expect(state.events.join("\n")).toContain(note);
  expect(logEvent).toHaveBeenCalled();
});
