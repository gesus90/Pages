import { expect, it } from "vitest";

import {
  OPENCODE_DECISION_PROFILE,
  OPENCODE_PICA_PROFILE,
  openCodeAcpProfile,
  openCodePlanPermissions,
} from "@/backend/agents/acp/OpenCodeAcpProfile";

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";

const MODEL = { model: "p/m", reasoningEffort: "high" };
const NO_EFFORT = { model: "p/m", reasoningEffort: null };

function request(kinds: readonly string[]): RequestPermissionRequest {
  return {
    sessionId: "s",
    toolCall: { toolCallId: "t" },
    options: kinds.map((kind) => ({ optionId: kind, name: kind, kind })),
  } as unknown as RequestPermissionRequest;
}

it("allows everything in YOLO and only reading in read-only mode", () => {
  expect(openCodePlanPermissions("yolo")).toEqual({ "*": "allow" });
  expect(openCodePlanPermissions("read_only")).toMatchObject({ "*": "deny" });
});

it("builds the read-only plan profile", () => {
  const profile = openCodeAcpProfile("read_only");
  expect(profile.permissions.shell).toBe("off");
  expect(profile.permissions.sessionMode).toBe("pages-read-only");
  expect(profile.steps(MODEL).map((step) => step.id)).toEqual([
    "mode",
    "model",
    "effort",
  ]);
  expect(profile.steps(NO_EFFORT)[2]).toMatchObject({
    value: "default",
    isOptional: true,
  });
  expect(profile.decide(request(["allow_once", "reject_once"])).isDenied).toBe(
    true,
  );
});

it("builds the YOLO plan profile and approves what is offered", () => {
  const profile = openCodeAcpProfile("yolo", "plan");
  expect(profile.permissions.shell).toBe("on");
  expect(profile.steps(MODEL)[2]).toMatchObject({ isOptional: false });
  expect(profile.decide(request(["allow_once"])).isDenied).toBe(false);
  expect(profile.decide(request([])).isDenied).toBe(true);
});

it("builds the full access chat profile for YOLO", () => {
  const profile = openCodeAcpProfile("yolo", "chat");
  expect(profile.permissions.pagesTools).toContain("Pica bridge");
});

it("takes the Pica profile for a read-only chat", () => {
  expect(openCodeAcpProfile("read_only", "chat")).toBe(OPENCODE_PICA_PROFILE);
});

it("takes the profile without tools for decisions and observers", () => {
  expect(openCodeAcpProfile("yolo", "decision")).toBe(
    OPENCODE_DECISION_PROFILE,
  );
  expect(openCodeAcpProfile("read_only", "observer")).toBe(
    OPENCODE_DECISION_PROFILE,
  );
});

it.each([OPENCODE_PICA_PROFILE, OPENCODE_DECISION_PROFILE])(
  "steps and refuses in a fixed profile",
  (profile) => {
    expect(profile.steps(MODEL)).toHaveLength(3);
    expect(profile.steps(NO_EFFORT)[2]).toMatchObject({ isOptional: true });
    expect(profile.decide(request(["reject_once"])).isDenied).toBe(true);
  },
);
