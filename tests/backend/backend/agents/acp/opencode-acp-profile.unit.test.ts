import { expect, it } from "vitest";

import {
  OPENCODE_PICA_PROFILE,
  openCodeAcpProfile,
  openCodePlanPermissions,
} from "@/backend/agents/acp/OpenCodeAcpProfile";

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";

const REQUEST: RequestPermissionRequest = {
  sessionId: "s-1",
  toolCall: { toolCallId: "t-1" },
  options: [
    { optionId: "allow", name: "Allow", kind: "allow_once" },
    { optionId: "reject", name: "Reject", kind: "reject_once" },
  ],
};

const WITHOUT_ALLOW: RequestPermissionRequest = {
  ...REQUEST,
  options: [{ optionId: "reject", name: "Reject", kind: "reject_always" }],
};

it("grants YOLO every tool but keeps secret files unreadable", () => {
  expect(openCodePlanPermissions("yolo")).toEqual({
    "*": "allow",
    read: { "*": "allow", "*.env": "deny", "*.env.*": "deny" },
  });
});

it("limits read-only nodes to reading tools and the Pages tools", () => {
  expect(openCodePlanPermissions("read_only")).toMatchObject({
    "*": "deny",
    list: "allow",
    "pages_*": "allow",
  });
});

it("describes a YOLO plan node and approves its requests", () => {
  const profile = openCodeAcpProfile("yolo");

  expect(profile.permissions).toMatchObject({
    sessionMode: "pages-yolo",
    files: "workspace write",
    shell: "on",
    tools: "all available native tools and authorized Pages MCP tools",
  });
  expect(profile.decide(REQUEST)).toEqual({
    outcome: { outcome: "selected", optionId: "allow" },
    isDenied: false,
  });
  expect(profile.decide(WITHOUT_ALLOW)).toEqual({
    outcome: { outcome: "cancelled" },
    isDenied: true,
  });
});

it("describes a read-only plan node and refuses its requests", () => {
  const profile = openCodeAcpProfile("read_only", "plan");

  expect(profile.permissions).toMatchObject({
    sessionMode: "pages-read-only",
    files: "read only",
    shell: "off",
    tools: "native reading tools and read-only Pages MCP tools",
  });
  expect(profile.decide(REQUEST)).toEqual({
    outcome: { outcome: "selected", optionId: "reject" },
    isDenied: true,
  });
});

it("confirms mode, model and an explicit effort of a plan node", () => {
  expect(
    openCodeAcpProfile("yolo").steps({
      model: "zai/glm-5",
      reasoningEffort: "high",
    }),
  ).toEqual([
    {
      id: "mode",
      value: "pages-yolo",
      refusal: "plan_permission_mode_unenforceable",
    },
    { id: "model", value: "zai/glm-5", refusal: "plan_model_unavailable" },
    {
      id: "effort",
      value: "high",
      refusal: "plan_reasoning_unsupported",
      isOptional: false,
    },
  ]);
});

it("treats a missing effort of a plan node as the optional default", () => {
  expect(
    openCodeAcpProfile("read_only")
      .steps({ model: "m", reasoningEffort: null })
      .at(-1),
  ).toEqual({
    id: "effort",
    value: "default",
    refusal: "plan_reasoning_unsupported",
    isOptional: true,
  });
});

it("gives Pica its own read-only profile", () => {
  expect(openCodeAcpProfile("read_only", "chat")).toBe(OPENCODE_PICA_PROFILE);
});

it("refuses Pica in any other mode", () => {
  expect(() => openCodeAcpProfile("yolo", "chat")).toThrow(
    expect.objectContaining({ code: "opencode_chat_mode_required" }),
  );
});

it("confirms Pica's mode and model and refuses its permission requests", () => {
  expect(
    OPENCODE_PICA_PROFILE.steps({ model: "m", reasoningEffort: null }),
  ).toEqual([
    {
      id: "mode",
      value: "pages-pica",
      refusal: "plan_permission_mode_unenforceable",
    },
    { id: "model", value: "m", refusal: "plan_model_unavailable" },
    {
      id: "effort",
      value: "default",
      refusal: "plan_reasoning_unsupported",
      isOptional: true,
    },
  ]);
  expect(
    OPENCODE_PICA_PROFILE.steps({ model: "m", reasoningEffort: "low" }).at(-1),
  ).toMatchObject({ value: "low", isOptional: false });
  expect(OPENCODE_PICA_PROFILE.decide(REQUEST).isDenied).toBe(true);
});
