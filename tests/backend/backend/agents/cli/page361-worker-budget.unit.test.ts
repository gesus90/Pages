import { expect, it } from "vitest";

import { acpDriverFor } from "@/backend/agents/acp/AcpDrivers";
import { acpWorkerRequest } from "@/backend/agents/cli/CliAcpLaunch";
import { acpRunOptions } from "@/definition/AgentConfiguration";

import { sessionInput } from "./cli-session-input";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AcpProviderId } from "@/definition/AgentConfiguration";
import type { CliSessionRequest } from "@/backend/agents/cli/CliContracts";

const RESOURCE_CONTEXT = {
  planId: "plan",
  runId: "run",
  stepId: "agent",
  sessionScopeId: "agent",
};

function requestFor(
  input: AgentPlanSessionInput,
  provider: AcpProviderId,
): CliSessionRequest {
  return acpWorkerRequest({
    input,
    provider,
    driver: acpDriverFor(provider),
    mode: "yolo",
    launch: { environment: {}, mcpServers: [], sessionMeta: {} },
    adapter: "/synthetic/adapter",
    home: {
      root: "/synthetic",
      home: "/synthetic/home",
      config: "/synthetic/config",
      work: "/synthetic/work",
    },
    github: null,
    picaNative: null,
    picaBundle: null,
    signal: new AbortController().signal,
    onLine: () => undefined,
  });
}

it.each([0, 1, 30])(
  "keeps a bounded active-time budget for Codex plan timeout %s without a competing wall deadline",
  (minutes) => {
    const input = sessionInput("codex_cli", acpRunOptions("yolo", minutes), {
      resourceContext: RESOURCE_CONTEXT,
    });
    expect(requestFor(input, "codex_cli")).toMatchObject({
      pausesRuntime: true,
      timeoutMs: (minutes || 24 * 60) * 60_000,
    });
  },
);

it("preserves the worker deadline of Claude and a Codex chat", () => {
  const claude = sessionInput("claude_code", acpRunOptions("yolo", 2), {
    resourceContext: RESOURCE_CONTEXT,
  });
  const chat = sessionInput("codex_cli", acpRunOptions("yolo", 2), {
    resourceContext: RESOURCE_CONTEXT,
    chat: {
      resumeSessionId: null,
      listener: {
        prompted: () => undefined,
        update: () => undefined,
        closed: () => undefined,
      },
    },
  });
  expect(requestFor(claude, "claude_code")).toMatchObject({
    pausesRuntime: false,
    timeoutMs: 120_000,
  });
  expect(requestFor(chat, "codex_cli")).toMatchObject({
    pausesRuntime: false,
    timeoutMs: 120_000,
  });
});
