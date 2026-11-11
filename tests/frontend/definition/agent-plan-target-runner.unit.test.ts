import { describe, expect, it } from "vitest";

import { DEFAULT_ACP_RUN_OPTIONS } from "@/definition/AgentConfiguration";
import { planTargetIssues } from "@/definition/AgentPlanTarget";

import type { AgentProviderId } from "@/definition/AgentConnection";
import type { AgentPlanInput, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanRemoteStatus } from "@/definition/AgentPlanTarget";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CONNECTION = "33333333-3333-4333-8333-333333333333";

/** An agent node of the given provider whose route leads to the remote workspace. */
function agentOf(provider: AgentProviderId | null): AgentPlanStep {
  return {
    id: "a",
    type: "agent",
    agentId: "agent",
    personalAgentId: null,
    instruction: "",
    x: 0,
    y: 0,
    bindings: {},
    configuration: {
      name: "Configuration",
      revision: 1,
      modelProfileId: "profile",
      model: "model-a",
      provider,
      reasoningEffort: null,
      runnerRoute: {
        connectionId: CONNECTION,
        workspaceId: WORKSPACE,
        catalogRevision: "rev-1",
      },
      template: {
        markdown: "",
        parameters: [],
        directoryParameter: null,
        run: DEFAULT_ACP_RUN_OPTIONS,
      },
    },
  };
}

function toolOf(
  tool: "codex" | "antigravity",
  fields: Partial<AgentPlanRemoteStatus["tools"][number]> = {},
): AgentPlanRemoteStatus["tools"][number] {
  return {
    tool,
    version: "1.0.0",
    authentication: "authenticated",
    catalogRevision: "rev-1",
    models: [{ id: "model-a", name: "Model A", reasoningEfforts: [] }],
    ...fields,
  };
}

function statusOf(
  fields: Partial<AgentPlanRemoteStatus> = {},
): AgentPlanRemoteStatus {
  return {
    workspaceId: WORKSPACE,
    problem: null,
    tools: [],
    hasModelCatalog: true,
    hasPagesAccess: true,
    hasExactResultPayload: true,
    ...fields,
  };
}

/** The problems of one agent node on a remote plan, as `node:problem`. */
function problemsOf(
  node: AgentPlanStep,
  status: AgentPlanRemoteStatus,
): readonly string[] {
  const plan: AgentPlanInput = {
    name: "Plan",
    workspaceId: WORKSPACE,
    usage: "private",
    globals: {},
    nodes: [node],
    edges: [],
    executionTarget: { kind: "remote", workspaceId: WORKSPACE },
  };
  return planTargetIssues(plan, [status]).map(
    (issue) => `${issue.nodeId}:${issue.problem}`,
  );
}

describe("planTargetIssues: Antigravity on a remote runner", () => {
  const withAcp = (
    acp: "verified" | "compatible" | undefined,
    authentication: "authenticated" | "not_logged_in" = "authenticated",
  ): AgentPlanRemoteStatus =>
    statusOf({
      tools: [
        toolOf("antigravity", {
          authentication,
          ...(acp ? { acp: { status: acp, reason: "contract_matches" } } : {}),
        }),
      ],
    });

  it("needs a verified ACP contract before the login is read", () => {
    const node = agentOf("antigravity");

    expect(problemsOf(node, withAcp(undefined, "not_logged_in"))).toEqual([
      "a:remoteToolIncompatible",
    ]);
    expect(problemsOf(node, withAcp("compatible", "not_logged_in"))).toEqual([
      "a:remoteToolIncompatible",
    ]);
    expect(problemsOf(node, withAcp("verified", "not_logged_in"))).toEqual([
      "a:remoteLogin",
    ]);
  });

  it("accepts a verified, logged-in tool whose catalog matches the node", () => {
    expect(problemsOf(agentOf("antigravity"), withAcp("verified"))).toEqual([]);
  });
});

describe("planTargetIssues: runner capabilities", () => {
  it("asks for a runner update before the login of a command line tool is read", () => {
    const tools = [toolOf("codex", { authentication: "not_logged_in" })];

    expect(
      problemsOf(
        agentOf("codex_cli"),
        statusOf({ hasExactResultPayload: false, tools }),
      ),
    ).toEqual(["a:remoteRunnerUpdate"]);
    expect(
      problemsOf(
        agentOf("codex_cli"),
        statusOf({ hasExactResultPayload: undefined, tools }),
      ),
    ).toEqual(["a:remoteRunnerUpdate"]);
  });

  it("treats a node without a provider as an API node of the runner catalog", () => {
    const unnamed = agentOf(null);

    expect(problemsOf(unnamed, statusOf({ hasModelCatalog: false }))).toEqual([
      "a:remoteCatalog",
    ]);
    expect(problemsOf(unnamed, statusOf({ modelIds: ["other"] }))).toEqual([
      "a:remoteModel",
    ]);
    expect(
      problemsOf(
        unnamed,
        statusOf({ modelIds: ["model-a"], catalogRevision: "rev-1" }),
      ),
    ).toEqual([]);
  });
});
