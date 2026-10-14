import { expect, it } from "vitest";

import { readAgentConfiguration } from "@/backend/agents/AgentConfigurationInput";
import { readPlanSessionRecord } from "@/backend/agents/AgentPlanSessionInput";
import {
  planCliSession,
  unsupportedRunOption,
} from "@/backend/agents/cli/CliSessionPlans";
import { AgentError } from "@/backend/error/AgentErrors";
import { requireAllowedRunOptions } from "@/backend/service/agents/AgentProfileValidation";
import { planSessionReach } from "@/backend/service/agents/AgentPlanSessionAccess";
import { planStepDirectory } from "@/backend/service/agents/AgentPlanSnapshot";
import {
  DEFAULT_AGENT_RUN_OPTIONS,
  DEFAULT_CODEX_RUN_OPTIONS,
  agentRunOptionsFor,
  codexRunOptions,
  emptyAgentConfiguration,
  isAgentRunOptionsAllowed,
} from "@/definition/AgentConfiguration";

import type { AgentRunOptions } from "@/definition/AgentConfiguration";
import type { ResolvedAgentWorkspace } from "@/definition/AgentWorkspace";

const LEGACY_WRITE: AgentRunOptions = {
  access: "workspace_write",
  shell: true,
  web: false,
  timeoutMinutes: 10,
};

function workspace(id: string): ResolvedAgentWorkspace {
  return {
    id,
    path: `/synthetic/${id}`,
    directoryIdentity: id,
    revision: 1,
    projectId: "project",
    github: null,
  };
}

it("reads a Codex agent without run options as Nur Lesen and derives shell and web from the mode alone", () => {
  expect(agentRunOptionsFor("codex_cli", undefined)).toEqual(
    DEFAULT_CODEX_RUN_OPTIONS,
  );
  expect(DEFAULT_CODEX_RUN_OPTIONS).toEqual({
    access: "read_only",
    shell: false,
    web: true,
    timeoutMinutes: 0,
  });
  expect(
    agentRunOptionsFor("codex_cli", {
      access: "read_only",
      shell: true,
      web: false,
      timeoutMinutes: 5,
    }),
  ).toEqual({
    access: "read_only",
    shell: false,
    web: true,
    timeoutMinutes: 5,
  });
  expect(
    agentRunOptionsFor("codex_cli", {
      access: "yolo",
      shell: false,
      web: false,
      timeoutMinutes: 7,
    }),
  ).toEqual(codexRunOptions("yolo", 7));
});

it("never raises a stored or missing configuration to YOLO", () => {
  expect(agentRunOptionsFor("codex_cli", LEGACY_WRITE)).toEqual(LEGACY_WRITE);
  expect(unsupportedRunOption("codex_cli", LEGACY_WRITE)).toBe(
    "codex_permission_mode_required",
  );
  expect(
    unsupportedRunOption(
      "codex_cli",
      agentRunOptionsFor("codex_cli", DEFAULT_AGENT_RUN_OPTIONS),
    ),
  ).toBe("codex_permission_mode_required");
  for (const mode of ["read_only", "yolo"] as const)
    expect(unsupportedRunOption("codex_cli", codexRunOptions(mode, 0))).toBe(
      null,
    );
});

it("keeps the run options of every other runner as they were", () => {
  expect(agentRunOptionsFor("claude_code", undefined)).toEqual(
    DEFAULT_AGENT_RUN_OPTIONS,
  );
  expect(agentRunOptionsFor("opencode", LEGACY_WRITE)).toEqual(LEGACY_WRITE);
  expect(agentRunOptionsFor("openrouter", undefined)).toEqual(
    DEFAULT_AGENT_RUN_OPTIONS,
  );
  expect(
    unsupportedRunOption("claude_code", {
      ...DEFAULT_AGENT_RUN_OPTIONS,
      access: "read_only",
      shell: true,
    }),
  ).toBe("plan_run_option_unsupported");
  expect(unsupportedRunOption("opencode", LEGACY_WRITE)).toBeNull();
  expect(unsupportedRunOption("claude_code", codexRunOptions("yolo", 0))).toBe(
    "plan_run_option_unsupported",
  );
});

it("stores only the two modes for a Codex agent, keeps an unchanged earlier write mode and offers YOLO to no other runner", () => {
  expect(isAgentRunOptionsAllowed("codex_cli", LEGACY_WRITE, undefined)).toBe(
    false,
  );
  expect(
    isAgentRunOptionsAllowed("codex_cli", LEGACY_WRITE, { ...LEGACY_WRITE }),
  ).toBe(true);
  expect(
    isAgentRunOptionsAllowed(
      "codex_cli",
      { ...LEGACY_WRITE, timeoutMinutes: 11 },
      LEGACY_WRITE,
    ),
  ).toBe(false);
  expect(isAgentRunOptionsAllowed("codex_cli", undefined, undefined)).toBe(
    true,
  );
  expect(
    isAgentRunOptionsAllowed(
      "codex_cli",
      codexRunOptions("yolo", 0),
      LEGACY_WRITE,
    ),
  ).toBe(true);
  expect(
    isAgentRunOptionsAllowed(
      "claude_code",
      codexRunOptions("yolo", 0),
      undefined,
    ),
  ).toBe(false);
  expect(isAgentRunOptionsAllowed("claude_code", LEGACY_WRITE, undefined)).toBe(
    true,
  );
  expect(() =>
    requireAllowedRunOptions("codex_cli", LEGACY_WRITE, undefined),
  ).toThrow(new AgentError("codex_permission_mode_required"));
  expect(() =>
    requireAllowedRunOptions("opencode", codexRunOptions("yolo", 0), undefined),
  ).toThrow(new AgentError("plan_run_option_unsupported"));
});

it("reads YOLO from AGENT.md and from stored run records", () => {
  const configuration = readAgentConfiguration({
    ...emptyAgentConfiguration(),
    run: codexRunOptions("yolo", 3),
  });
  expect(configuration.run).toEqual(codexRunOptions("yolo", 3));
  expect(() =>
    readAgentConfiguration({
      ...emptyAgentConfiguration(),
      run: { ...codexRunOptions("yolo", 3), access: "full" },
    }),
  ).toThrow(new AgentError("configuration_invalid"));
  const record = readPlanSessionRecord({
    runner: "codex_cli",
    mode: "interactive",
    instanceId: "instance",
    closeout: "pending",
    resultCode: null,
    requested: {
      runner: "codex_cli",
      connectionId: "connection",
      connectionName: "Codex",
      model: "gpt-synthetic",
      reasoningEffort: "high",
      options: codexRunOptions("yolo", 0),
      unattended: "ACP",
      mcp: true,
      directory: "/synthetic",
    },
    events: [],
  });
  expect(record?.requested.options?.access).toBe("yolo");
});

it("gives a Codex session the read or the full Pages reach and every other runner its bound tickets", () => {
  expect(planSessionReach("codex_cli", DEFAULT_CODEX_RUN_OPTIONS)).toBe("read");
  expect(planSessionReach("codex_cli", codexRunOptions("yolo", 0))).toBe(
    "full",
  );
  expect(planSessionReach("claude_code", DEFAULT_AGENT_RUN_OPTIONS)).toBe(
    "tickets",
  );
  expect(planSessionReach("opencode", codexRunOptions("yolo", 0))).toBe(
    "tickets",
  );
});

it("runs a Codex node in the plan's workspace unless the agent names its own directory, which takes precedence", () => {
  const prepared = {
    parameters: { markdown: "", directory: null, values: {}, wikiVersions: {} },
    workspace: workspace("plan"),
    directory: null,
    references: [],
    wiki: {},
  };
  expect(planStepDirectory({ provider: "codex_cli", prepared })?.id).toBe(
    "plan",
  );
  expect(
    planStepDirectory({
      provider: "codex_cli",
      prepared: { ...prepared, directory: workspace("parameter") },
    })?.id,
  ).toBe("parameter");
  expect(planStepDirectory({ provider: "claude_code", prepared })).toBeNull();
});

it("starts Claude Code and OpenCode with exactly the switches they had before", () => {
  const specification = {
    instanceId: "instance",
    model: "synthetic-model",
    reasoningEffort: "high",
    options: { ...DEFAULT_AGENT_RUN_OPTIONS, shell: true },
    directory: "/synthetic",
    prompt: "Prompt",
    mcp: null,
  };
  expect(planCliSession("claude_code", specification).arguments).toEqual([
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--restricted",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--permission-mode",
    "acceptEdits",
    "--permission-prompts",
    "none",
    "--max-turns",
    "200",
    "--tools",
    "Read,Glob,Grep,Edit,Write,Bash",
    "--allowedTools",
    "Bash",
    "--model",
    "synthetic-model",
    "--effort",
    "high",
  ]);
  expect(planCliSession("opencode", specification).arguments).toEqual([
    "run",
    "--format",
    "json",
    "--pure",
    "-m",
    "synthetic-model",
    "--dir",
    "/synthetic",
    "--variant",
    "high",
  ]);
});
