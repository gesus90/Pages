import { expect, it } from "vitest";

import {
  agentRunOptionsFor,
  DEFAULT_ACP_RUN_OPTIONS,
  DEFAULT_AGENT_RUN_OPTIONS,
  emptyAgentConfiguration,
  isAgentRunOptionsAllowed,
} from "@/definition/AgentConfiguration";

import type { AgentRunOptions } from "@/definition/AgentConfiguration";

const LEGACY_WRITE: AgentRunOptions = {
  access: "workspace_write",
  shell: true,
  web: false,
  timeoutMinutes: 5,
};

it("applies the provider defaults when an agent names no options", () => {
  expect(agentRunOptionsFor("codex_cli", undefined)).toBe(
    DEFAULT_ACP_RUN_OPTIONS,
  );
  expect(agentRunOptionsFor("openai", undefined)).toBe(
    DEFAULT_AGENT_RUN_OPTIONS,
  );
});

it("keeps stored options outside the ACP modes unchanged", () => {
  expect(agentRunOptionsFor("openai", LEGACY_WRITE)).toBe(LEGACY_WRITE);
  expect(agentRunOptionsFor("claude_code", LEGACY_WRITE)).toBe(LEGACY_WRITE);
});

it("derives shell and web of an ACP agent from its mode", () => {
  expect(
    agentRunOptionsFor("opencode", {
      access: "read_only",
      shell: true,
      web: false,
      timeoutMinutes: 9,
    }),
  ).toEqual({
    access: "read_only",
    shell: false,
    web: true,
    timeoutMinutes: 9,
  });
  expect(
    agentRunOptionsFor("codex_cli", {
      access: "yolo",
      shell: false,
      web: false,
      timeoutMinutes: 0,
      browser: true,
    }),
  ).toEqual({
    access: "yolo",
    shell: true,
    web: true,
    timeoutMinutes: 0,
    browser: true,
  });
});

it("allows the browser only for an ACP agent in YOLO", () => {
  const browser: AgentRunOptions = {
    ...DEFAULT_ACP_RUN_OPTIONS,
    access: "yolo",
    browser: true,
  };
  expect(isAgentRunOptionsAllowed("codex_cli", browser, undefined)).toBe(true);
  expect(isAgentRunOptionsAllowed("openai", browser, undefined)).toBe(false);
  expect(
    isAgentRunOptionsAllowed(
      "codex_cli",
      { ...browser, access: "read_only" },
      undefined,
    ),
  ).toBe(false);
});

it("refuses YOLO outside the ACP runners", () => {
  expect(isAgentRunOptionsAllowed("openai", LEGACY_WRITE, undefined)).toBe(
    true,
  );
  expect(isAgentRunOptionsAllowed("openai", undefined, undefined)).toBe(true);
  expect(
    isAgentRunOptionsAllowed(
      "openai",
      { ...LEGACY_WRITE, access: "yolo" },
      undefined,
    ),
  ).toBe(false);
});

it("lets an ACP agent keep but not newly store the earlier write mode", () => {
  expect(isAgentRunOptionsAllowed("opencode", undefined, undefined)).toBe(true);
  expect(
    isAgentRunOptionsAllowed("opencode", DEFAULT_ACP_RUN_OPTIONS, undefined),
  ).toBe(true);
  expect(
    isAgentRunOptionsAllowed("opencode", LEGACY_WRITE, { ...LEGACY_WRITE }),
  ).toBe(true);
  expect(isAgentRunOptionsAllowed("opencode", LEGACY_WRITE, undefined)).toBe(
    false,
  );
});

it("creates personal and shared empty configurations by scope", () => {
  expect(emptyAgentConfiguration().accessMode).toBe("personal");
  expect(emptyAgentConfiguration("group")).toMatchObject({
    scope: "group",
    accessMode: "shared",
    sharing: { isGlobal: false, targets: [] },
  });
});
