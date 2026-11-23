import { expect, it } from "vitest";

import {
  requireAcpIsolation,
  sessionRunOptionError,
  unsupportedRunOption,
} from "./CliSessionPlans";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AgentRunOptions } from "@/definition/AgentConfiguration";

function runOptions(access: unknown): AgentRunOptions {
  return { access } as unknown as AgentRunOptions;
}

function sessionInput(
  provider: string,
  access: unknown,
  isChat = false,
): AgentPlanSessionInput {
  return {
    agent: { connection: { provider } },
    options: { access },
    ...(isChat ? { chat: {} } : {}),
  } as unknown as AgentPlanSessionInput;
}

it("accepts both stored access modes and the earlier full environment", () => {
  expect(unsupportedRunOption("codex_cli", runOptions("yolo"))).toBeNull();
  expect(unsupportedRunOption("codex_cli", runOptions("read_only"))).toBeNull();
  expect(
    unsupportedRunOption("codex_cli", runOptions("full_environment")),
  ).toBeNull();
});

it("names the driver error for an earlier mode without a choice", () => {
  expect(unsupportedRunOption("codex_cli", runOptions("workspace_write"))).toBe(
    "codex_permission_mode_required",
  );
  expect(unsupportedRunOption("claude_code", runOptions(undefined))).toBe(
    "claude_permission_mode_required",
  );
});

it("refuses a session of a provider without ACP", () => {
  expect(sessionRunOptionError(sessionInput("synthetic", "yolo"))).toBe(
    "provider_invalid",
  );
});

it("checks the run options of an ACP session", () => {
  expect(sessionRunOptionError(sessionInput("opencode", "yolo"))).toBeNull();
  expect(sessionRunOptionError(sessionInput("opencode", "other"))).toBe(
    "opencode_permission_mode_required",
  );
});

it("does not require isolation when isolated or in YOLO", () => {
  expect(() =>
    requireAcpIsolation(true, "read_only", sessionInput("opencode", "x", true)),
  ).not.toThrow();
  expect(() =>
    requireAcpIsolation(false, "yolo", sessionInput("opencode", "x", true)),
  ).not.toThrow();
});

it.each(["opencode", "openrouter", "antigravity"])(
  "refuses %s read-only without isolation",
  (provider) => {
    expect(() =>
      requireAcpIsolation(false, "read_only", sessionInput(provider, "x")),
    ).toThrow(expect.objectContaining({ code: "cli_isolation_unavailable" }));
  },
);

it("refuses a read-only conversation without isolation", () => {
  expect(() =>
    requireAcpIsolation(
      false,
      "read_only",
      sessionInput("codex_cli", "x", true),
    ),
  ).toThrow(expect.objectContaining({ code: "cli_isolation_unavailable" }));
});

it("lets Codex and Claude Code enforce read-only plan nodes themselves", () => {
  for (const provider of ["codex_cli", "claude_code"])
    expect(() =>
      requireAcpIsolation(false, "read_only", sessionInput(provider, "x")),
    ).not.toThrow();
});
