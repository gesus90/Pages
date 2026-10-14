import { expect, it } from "vitest";

import { readMcpServerStatus } from "@/backend/agents/acp/AcpMcpStatus";
import { isSupportedClaudeAcp } from "@/backend/agents/acp/ClaudeAcpAdapter";
import { CLAUDE_ACP_DRIVER } from "@/backend/agents/acp/ClaudeAcpDriver";
import {
  claudeAcpProfile,
  claudeModelMatches,
  decideClaudePermission,
} from "@/backend/agents/acp/ClaudeAcpProfile";

import type {
  RequestPermissionRequest,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";

const OPTIONS: RequestPermissionRequest["options"] = [
  { optionId: "allow-once", name: "Allow", kind: "allow_once" },
  { optionId: "allow-always", name: "Always", kind: "allow_always" },
  { optionId: "reject", name: "Reject", kind: "reject_once" },
];

/** A request as the real adapter sends it: MCP tools carry their name in `_meta`, built-in tools in `name`. */
function request(
  toolName: string | null,
  server: string | null = null,
): RequestPermissionRequest {
  const isMcp = toolName?.startsWith("mcp__") === true;
  const toolCall: ToolCallUpdate & { readonly name?: string } = {
    toolCallId: "call",
    title: toolName ?? "request",
    ...(toolName === null || isMcp ? {} : { name: toolName }),
    ...(isMcp
      ? {
          _meta: {
            claudeCode: {
              toolName,
              ...(server === null ? {} : { mcpServer: { name: server } }),
            },
          },
        }
      : {}),
  };
  return { sessionId: "session", toolCall, options: OPTIONS };
}

it("maps Nur Lesen to the default mode with the reading tools only, and keeps user and workspace settings and other MCP servers out", () => {
  const profile = claudeAcpProfile("read_only");
  expect(profile.sessionMode).toBe("default");
  expect(profile.options).toMatchObject({
    settingSources: [],
    strictMcpConfig: true,
    persistSession: false,
    tools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
    disallowedTools: ["Bash", "PowerShell", "Edit", "Write", "NotebookEdit"],
    extraArgs: { "disable-slash-commands": null },
  });
  expect(profile.permissions).toMatchObject({
    shell: "off",
    files: "read",
    pagesMcp: "read",
    mcpServers: "pages only",
  });
});

it("maps YOLO to bypassPermissions with every native tool and without any tool restriction", () => {
  const profile = claudeAcpProfile("yolo");
  expect(profile.sessionMode).toBe("bypassPermissions");
  expect(profile.options).toMatchObject({
    settingSources: [],
    strictMcpConfig: true,
  });
  expect(profile.options).not.toHaveProperty("tools");
  expect(profile.options).not.toHaveProperty("disallowedTools");
  expect(profile.unattended).toContain("bubblewrap");
});

it("derives the steps in the order mode, model, effort and leaves the effort out when none is stored", () => {
  const profile = claudeAcpProfile("yolo");
  expect(
    profile
      .steps({ model: "claude-sonnet-5-5", reasoningEffort: "xhigh" })
      .map((step) => [step.id, step.value]),
  ).toEqual([
    ["mode", "bypassPermissions"],
    ["model", "claude-sonnet-5-5"],
    ["effort", "xhigh"],
  ]);
  expect(
    profile.steps({ model: "claude-sonnet-5-5", reasoningEffort: null }),
  ).toHaveLength(2);
  expect(
    profile.steps({ model: "claude-sonnet-5-5", reasoningEffort: null })[1],
  ).toMatchObject({ isResolvedByAdapter: true });
});

it.each([
  ["0.90.0", true],
  ["0.90.7", true],
  ["0.89.2", false],
  ["0.91.0", false],
  ["1.0.0", false],
  ["0.90.1-preview.11", false],
])("accepts claude-agent-acp %s: %s", (version, isSupported) => {
  expect(
    isSupportedClaudeAcp({
      name: "@agentclientprotocol/claude-agent-acp",
      version,
    }),
  ).toBe(isSupported);
});

it("refuses an adapter of another name and an adapter that did not name itself", () => {
  expect(
    isSupportedClaudeAcp({
      name: "@agentclientprotocol/codex-acp",
      version: "0.90.0",
    }),
  ).toBe(false);
  expect(isSupportedClaudeAcp(null)).toBe(false);
  expect(isSupportedClaudeAcp(undefined)).toBe(false);
});

it("starts the adapter with the Claude CLI of the connection and keeps the MCP credential out of its environment", () => {
  const profile = claudeAcpProfile("read_only");
  const launch = CLAUDE_ACP_DRIVER.plan({
    instanceId: "instance",
    runnerFile: "/synthetic/bin/claude",
    profile,
    mcp: {
      node: "/synthetic/bin/node",
      bundle: "/synthetic/mcp.cjs",
      url: "http://pages.invalid",
      token: "secret-run-token",
      tools: null,
    },
  });
  expect(launch.environment).toEqual({
    PAGES_RUN_INSTANCE: "instance",
    CLAUDE_CODE_EXECUTABLE: "/synthetic/bin/claude",
    CLAUDE_CODE_DISABLE_MODEL_ACCESS_FALLBACK: "1",
    CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP: "1",
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  });
  expect(JSON.stringify(launch.environment)).not.toContain("secret-run-token");
  expect(launch.sessionMeta).toEqual({
    claudeCode: { options: profile.options },
  });
  expect(launch.mcpServers).toEqual([
    {
      name: "pages",
      command: "/synthetic/bin/node",
      args: ["/synthetic/mcp.cjs"],
      env: [
        { name: "PAGES_URL", value: "http://pages.invalid" },
        { name: "PAGES_TOKEN", value: "secret-run-token" },
        { name: "PAGES_RUN_INSTANCE", value: "instance" },
      ],
    },
  ]);
  expect(
    CLAUDE_ACP_DRIVER.plan({
      instanceId: "instance",
      runnerFile: "/synthetic/bin/claude",
      profile,
      mcp: null,
    }).mcpServers,
  ).toEqual([]);
});

it.each([
  ["a Pages MCP tool", request("mcp__pages__read_ticket", "pages"), true],
  [
    "a Pages MCP tool without server information",
    request("mcp__pages__x"),
    true,
  ],
  ["web search", request("WebSearch"), true],
  ["web fetch", request("WebFetch"), true],
  ["a shell command", request("Bash"), false],
  ["a file change", request("Write"), false],
  ["an edit", request("Edit"), false],
  ["a read outside the workspace", request("Read"), false],
  [
    "an MCP tool of another server",
    request("mcp__other__tool", "other"),
    false,
  ],
  [
    "a tool named like a Pages tool of another server",
    request("mcp__pages__x", "other"),
    false,
  ],
  ["a request without a tool name", request(null), false],
])("answers %s in Nur Lesen: approved is %s", (scenario, input, isApproved) => {
  const decision = decideClaudePermission("read_only", input);
  expect(decision.isDenied).toBe(!isApproved);
  expect(decision.outcome).toEqual({
    outcome: "selected",
    optionId: isApproved ? "allow-once" : "reject",
  });
});

it.each([
  ["claude-sonnet-5-5", "claude-sonnet-5-5", true],
  ["claude-sonnet-5-5", "claude-sonnet-5-5[1m]", true],
  ["claude-sonnet-5-5[1m]", "claude-sonnet-5-5", true],
  ["claude-sonnet-5-5", "claude-haiku-5-5", false],
  ["claude-sonnet-5-5", "claude-sonnet-5-4", false],
  ["sonnet", "claude-sonnet-5-5", true],
  ["default", "claude-opus-5-5", true],
])(
  "compares the stored model %s with the reported %s: %s",
  (stored, reported, isSame) => {
    expect(claudeModelMatches(stored, reported)).toBe(isSame);
  },
);

it("approves every request in YOLO once and never stores an approval", () => {
  for (const name of ["Bash", "Write", "mcp__pages__create_ticket", null]) {
    expect(decideClaudePermission("yolo", request(name))).toEqual({
      outcome: { outcome: "selected", optionId: "allow-once" },
      isDenied: false,
    });
  }
});

it("reads the name of a built-in tool from the metadata too", () => {
  const withMetaOnly: RequestPermissionRequest = {
    sessionId: "session",
    toolCall: {
      toolCallId: "call",
      _meta: { claudeCode: { toolName: "WebFetch" } },
    },
    options: OPTIONS,
  };
  expect(decideClaudePermission("read_only", withMetaOnly).isDenied).toBe(
    false,
  );
});

it("cancels a request it cannot answer with a matching option", () => {
  const withoutReject: RequestPermissionRequest = {
    ...request("Bash"),
    options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
  };
  expect(decideClaudePermission("read_only", withoutReject)).toEqual({
    outcome: { outcome: "cancelled" },
    isDenied: true,
  });
});

it.each([
  [
    "**MCP servers:** 1 (1 connected)\n\n**Connected**\n- `pages`: 2 tools\n",
    "connected",
  ],
  [
    "**MCP servers:** 1 (1 failed)\n\n**Failed**\n- `pages`: Connection closed\n",
    "failed",
  ],
  [
    "**MCP servers:** 1 (1 need authentication)\n\n**Needs authentication**\n- `pages`\n",
    "failed",
  ],
  [
    "**MCP servers:** 1 (1 connecting)\n\n**Connecting**\n- `pages`\n",
    "connecting",
  ],
  [
    "**MCP servers:** 2 (1 failed, 1 connected)\n\n**Failed**\n- `other`: x\n\n**Connected**\n- `pages`: 2 tools\n",
    "connected",
  ],
  ["**MCP servers:** 0\n", "unknown"],
  ["**Disabled:** `pages`\n", "unknown"],
  ["something the adapter never printed before", "unknown"],
] as const)("reads the status of the Pages server from %j", (text, status) => {
  expect(readMcpServerStatus(text, "pages")).toBe(status);
});
