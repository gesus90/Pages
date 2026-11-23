import { expect, it } from "vitest";

import {
  ANTIGRAVITY_ACP_DRIVER,
  ANTIGRAVITY_READ_TOOLS,
} from "@/backend/agents/acp/AntigravityAcpDriver";

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import type {
  AcpLaunchSpecification,
  AcpSessionPurpose,
} from "@/backend/agents/acp/AcpDriver";
import type { AcpPermissionMode } from "@/definition/AgentConfiguration";

function request(kind?: string, title?: string): RequestPermissionRequest {
  return {
    sessionId: "s1",
    toolCall: { toolCallId: "t1", kind, title },
    options: [
      { optionId: "yes", name: "Yes", kind: "allow_once" },
      { optionId: "no", name: "No", kind: "reject_once" },
    ],
  } as unknown as RequestPermissionRequest;
}

function profile(
  mode: AcpPermissionMode,
  purpose?: AcpSessionPurpose,
): ReturnType<typeof ANTIGRAVITY_ACP_DRIVER.profile> {
  return ANTIGRAVITY_ACP_DRIVER.profile(mode, purpose);
}

function specification(
  mode: AcpPermissionMode,
  purpose?: AcpSessionPurpose,
): AcpLaunchSpecification {
  return {
    instanceId: "instance-1",
    runnerFile: "/bin/agy",
    profile: profile(mode, purpose),
    mcp: { url: "https://pages.example", token: "secret", tools: null },
    purpose,
  };
}

it("selects model, effort and mode for every profile", () => {
  const request1 = { model: "gemini", reasoningEffort: "high" };
  for (const entry of [
    profile("read_only"),
    profile("yolo"),
    profile("read_only", "chat"),
    profile("yolo", "chat"),
    profile("yolo", "observer"),
  ])
    expect(entry.steps(request1).map((step) => step.id)).toEqual([
      "model",
      "thought_level",
      "mode",
    ]);
});

it("leaves out the thinking level without an effort", () => {
  expect(
    profile("yolo").steps({ model: "gemini", reasoningEffort: null }),
  ).toHaveLength(2);
});

it("approves only Pages tools in a read-only plan node", () => {
  const { decide } = profile("read_only");
  expect(decide(request("other", "Run mcp_pages_read")).isDenied).toBe(false);
  expect(decide(request(undefined, "Run mcp_pages_read")).isDenied).toBe(false);
  expect(decide(request("other", "Run mcp_x_read")).isDenied).toBe(true);
  expect(decide(request("other")).isDenied).toBe(true);
  expect(decide(request("execute", "Run mcp_pages_read")).isDenied).toBe(true);
});

it("approves everything in a yolo plan node", () => {
  expect(profile("yolo").decide(request("execute")).isDenied).toBe(false);
  expect(profile("yolo").permissions.files).toBe("workspace write");
  expect(profile("read_only").permissions.files).toBe("read only");
});

it("refuses native tool kinds in Pica's chat", () => {
  const { decide } = profile("read_only", "chat");
  expect(decide(request("execute")).isDenied).toBe(true);
  expect(decide(request("other")).isDenied).toBe(false);
  expect(decide(request()).isDenied).toBe(false);
});

it("gives the full-access chat the yolo permissions and the observer none", () => {
  expect(profile("yolo", "chat").permissions.pagesTools).toBeDefined();
  expect(profile("yolo", "chat").decide(request("execute")).isDenied).toBe(
    false,
  );
  expect(profile("yolo", "observer").decide(request("other")).isDenied).toBe(
    true,
  );
  expect(profile("yolo", "observer").permissions.mcpServers).toBe("none");
});

it("starts an observer with no tools", () => {
  const launch = ANTIGRAVITY_ACP_DRIVER.plan(specification("yolo", "observer"));
  expect(launch.mcpServers).toEqual([]);
  expect(launch.sessionMeta).toEqual({ antigravity: { enabledTools: [] } });
  expect(launch.environment.BROWSER).toBe("/bin/true");
});

it("starts a read-only chat without native tools and a full-access chat with them", () => {
  expect(
    ANTIGRAVITY_ACP_DRIVER.plan(specification("read_only", "chat")).sessionMeta,
  ).toEqual({
    antigravity: { enabledTools: [], eagerMcpServers: ["pages"] },
  });
  expect(
    ANTIGRAVITY_ACP_DRIVER.plan(specification("yolo", "chat")).sessionMeta,
  ).toEqual({ antigravity: { eagerMcpServers: ["pages"] } });
});

it("restricts a read-only plan node to the reading tools", () => {
  const launch = ANTIGRAVITY_ACP_DRIVER.plan(specification("read_only"));
  expect(launch.mcpServers).toHaveLength(1);
  expect(launch.sessionMeta).toEqual({
    antigravity: {
      enabledTools: ANTIGRAVITY_READ_TOOLS,
      eagerMcpServers: ["pages"],
    },
  });
});

it("leaves every native tool to a yolo plan node", () => {
  expect(
    ANTIGRAVITY_ACP_DRIVER.plan(specification("yolo")).sessionMeta,
  ).toEqual({ antigravity: { eagerMcpServers: ["pages"] } });
});
