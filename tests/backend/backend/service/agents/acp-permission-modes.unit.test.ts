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
  DEFAULT_ACP_RUN_OPTIONS,
  agentRunOptionsFor,
  acpRunOptions,
  emptyAgentConfiguration,
  isAgentRunOptionsAllowed,
} from "@/definition/AgentConfiguration";

import type { AgentRunOptions } from "@/definition/AgentConfiguration";
import type { ResolvedAgentWorkspace } from "@/definition/AgentWorkspace";

/** The runners of plan nodes that run as ACP sessions, with the code that asks for a mode. */
const ACP_RUNNERS = [
  { provider: "codex_cli", modeRequired: "codex_permission_mode_required" },
  { provider: "claude_code", modeRequired: "claude_permission_mode_required" },
] as const;

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

it.each(ACP_RUNNERS)(
  "reads a $provider agent without run options as Nur Lesen and derives shell and web from the mode alone",
  ({ provider }) => {
    expect(agentRunOptionsFor(provider, undefined)).toEqual(
      DEFAULT_ACP_RUN_OPTIONS,
    );
    expect(DEFAULT_ACP_RUN_OPTIONS).toEqual({
      access: "read_only",
      shell: false,
      web: true,
      timeoutMinutes: 0,
    });
    expect(
      agentRunOptionsFor(provider, {
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
      agentRunOptionsFor(provider, {
        access: "yolo",
        shell: false,
        web: false,
        timeoutMinutes: 7,
      }),
    ).toEqual(acpRunOptions("yolo", 7));
  },
);

it.each(ACP_RUNNERS)(
  "never raises a stored or missing $provider configuration to YOLO",
  ({ provider, modeRequired }) => {
    expect(agentRunOptionsFor(provider, LEGACY_WRITE)).toEqual(LEGACY_WRITE);
    expect(unsupportedRunOption(provider, LEGACY_WRITE)).toBe(modeRequired);
    expect(
      unsupportedRunOption(
        provider,
        agentRunOptionsFor(provider, DEFAULT_AGENT_RUN_OPTIONS),
      ),
    ).toBe(modeRequired);
    for (const mode of ["read_only", "yolo"] as const)
      expect(unsupportedRunOption(provider, acpRunOptions(mode, 0))).toBe(null);
  },
);

it("keeps the run options of every runner without ACP as they were", () => {
  expect(agentRunOptionsFor("opencode", undefined)).toEqual(
    DEFAULT_AGENT_RUN_OPTIONS,
  );
  expect(agentRunOptionsFor("opencode", LEGACY_WRITE)).toEqual(LEGACY_WRITE);
  expect(agentRunOptionsFor("openrouter", undefined)).toEqual(
    DEFAULT_AGENT_RUN_OPTIONS,
  );
  expect(
    unsupportedRunOption("opencode", {
      ...DEFAULT_AGENT_RUN_OPTIONS,
      access: "read_only",
      shell: true,
    }),
  ).toBe("plan_run_option_unsupported");
  expect(unsupportedRunOption("opencode", LEGACY_WRITE)).toBeNull();
  expect(unsupportedRunOption("opencode", acpRunOptions("yolo", 0))).toBe(
    "plan_run_option_unsupported",
  );
});

it.each(ACP_RUNNERS)(
  "stores only the two modes for a $provider agent and keeps an unchanged earlier write mode",
  ({ provider, modeRequired }) => {
    expect(isAgentRunOptionsAllowed(provider, LEGACY_WRITE, undefined)).toBe(
      false,
    );
    expect(
      isAgentRunOptionsAllowed(provider, LEGACY_WRITE, { ...LEGACY_WRITE }),
    ).toBe(true);
    expect(
      isAgentRunOptionsAllowed(
        provider,
        { ...LEGACY_WRITE, timeoutMinutes: 11 },
        LEGACY_WRITE,
      ),
    ).toBe(false);
    expect(isAgentRunOptionsAllowed(provider, undefined, undefined)).toBe(true);
    expect(
      isAgentRunOptionsAllowed(
        provider,
        acpRunOptions("yolo", 0),
        LEGACY_WRITE,
      ),
    ).toBe(true);
    expect(() =>
      requireAllowedRunOptions(provider, LEGACY_WRITE, undefined),
    ).toThrow(new AgentError(modeRequired));
  },
);

it("offers YOLO to no runner without ACP", () => {
  expect(
    isAgentRunOptionsAllowed("opencode", acpRunOptions("yolo", 0), undefined),
  ).toBe(false);
  expect(isAgentRunOptionsAllowed("opencode", LEGACY_WRITE, undefined)).toBe(
    true,
  );
  expect(
    isAgentRunOptionsAllowed("openrouter", acpRunOptions("yolo", 0), undefined),
  ).toBe(false);
  expect(() =>
    requireAllowedRunOptions("opencode", acpRunOptions("yolo", 0), undefined),
  ).toThrow(new AgentError("plan_run_option_unsupported"));
});

it("reads YOLO from AGENT.md and from stored run records", () => {
  const configuration = readAgentConfiguration({
    ...emptyAgentConfiguration(),
    run: acpRunOptions("yolo", 3),
  });
  expect(configuration.run).toEqual(acpRunOptions("yolo", 3));
  expect(() =>
    readAgentConfiguration({
      ...emptyAgentConfiguration(),
      run: { ...acpRunOptions("yolo", 3), access: "full" },
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
      options: acpRunOptions("yolo", 0),
      unattended: "ACP",
      mcp: true,
      directory: "/synthetic",
    },
    events: [],
  });
  expect(record?.requested.options?.access).toBe("yolo");
});

it.each(ACP_RUNNERS)(
  "gives a $provider session the read or the full Pages reach",
  ({ provider }) => {
    expect(planSessionReach(provider, DEFAULT_ACP_RUN_OPTIONS)).toBe("read");
    expect(planSessionReach(provider, acpRunOptions("yolo", 0))).toBe("full");
  },
);

it("gives every runner without ACP its bound tickets", () => {
  expect(planSessionReach("opencode", acpRunOptions("yolo", 0))).toBe(
    "tickets",
  );
  expect(planSessionReach("openrouter", DEFAULT_AGENT_RUN_OPTIONS)).toBe(
    "tickets",
  );
});

it.each(ACP_RUNNERS)(
  "runs a $provider node in the plan's workspace unless the agent names its own directory, which takes precedence",
  ({ provider }) => {
    const prepared = {
      parameters: {
        markdown: "",
        directory: null,
        values: {},
        wikiVersions: {},
      },
      workspace: workspace("plan"),
      directory: null,
      references: [],
      wiki: {},
    };
    expect(planStepDirectory({ provider, prepared })?.id).toBe("plan");
    expect(
      planStepDirectory({
        provider,
        prepared: { ...prepared, directory: workspace("parameter") },
      })?.id,
    ).toBe("parameter");
    expect(planStepDirectory({ provider: "opencode", prepared })).toBeNull();
  },
);

it("starts OpenCode with exactly the switches it had before", () => {
  const specification = {
    instanceId: "instance",
    model: "synthetic-model",
    reasoningEffort: "high",
    options: { ...DEFAULT_AGENT_RUN_OPTIONS, shell: true },
    directory: "/synthetic",
    prompt: "Prompt",
    mcp: null,
  };
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
