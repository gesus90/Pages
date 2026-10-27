import { describe, expect, it } from "vitest";

import {
  LOCAL_PLAN_TARGET,
  effectivePlanTarget,
  isSamePlanTarget,
  planTargetDeviations,
  planTargetIssues,
  scriptLocalPaths,
  withInheritedPlanTarget,
  withPlanTargetFollowed,
} from "@/definition/AgentPlanTarget";
import {
  DEFAULT_ACP_RUN_OPTIONS,
  DEFAULT_AGENT_RUN_OPTIONS,
} from "@/definition/AgentConfiguration";

import type { AgentPlanExecutionTarget } from "@/definition/AgentPlanExecution";
import type {
  AgentPlanInput,
  AgentPlanNode,
  AgentPlanStep,
} from "@/definition/AgentPlan";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { AgentPlanRemoteStatus } from "@/definition/AgentPlanTarget";
import type { AgentPlanScript } from "@/definition/AgentPlanScript";
import type { AgentProviderId } from "@/definition/AgentConnection";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE = "22222222-2222-4222-8222-222222222222";
const CONNECTION = "33333333-3333-4333-8333-333333333333";

const REMOTE: AgentPlanExecutionTarget = {
  kind: "remote",
  workspaceId: WORKSPACE,
};
const OTHER_REMOTE: AgentPlanExecutionTarget = {
  kind: "remote",
  workspaceId: OTHER_WORKSPACE,
};

interface ConfigurationOptions {
  readonly provider?: AgentProviderId | null;
  readonly model?: string;
  readonly catalogRevision?: string;
  readonly workspaceId?: string;
  readonly run?: AgentPlanConfiguration["template"]["run"];
  readonly parameterTypes?: readonly (
    "ticket" | "wiki" | "workspace" | "text"
  )[];
  readonly tool?: "codex" | "claude" | "opencode";
  readonly hasRoute?: boolean;
}

function configuration(
  options: ConfigurationOptions = {},
): AgentPlanConfiguration {
  const hasRoute = options.hasRoute ?? true;
  return {
    name: "Configuration",
    revision: 1,
    modelProfileId: "profile",
    model: options.model ?? "model-a",
    provider: options.provider === undefined ? "openrouter" : options.provider,
    reasoningEffort: null,
    ...(hasRoute
      ? {
          runnerRoute: {
            connectionId: CONNECTION,
            workspaceId: options.workspaceId ?? WORKSPACE,
            catalogRevision: options.catalogRevision ?? "rev-1",
            ...(options.tool ? { tool: options.tool } : {}),
          },
        }
      : {}),
    template: {
      markdown: "",
      parameters: (options.parameterTypes ?? []).map((type, index) => ({
        name: `${type}${index}`,
        type,
        description: "",
        isRequired: false,
        defaultValue: null,
      })),
      directoryParameter: null,
      run: options.run ?? DEFAULT_ACP_RUN_OPTIONS,
    },
  };
}

function agent(id: string, fields: Partial<AgentPlanStep> = {}): AgentPlanStep {
  return {
    id,
    type: "agent",
    agentId: "agent",
    personalAgentId: null,
    instruction: "",
    x: 0,
    y: 0,
    bindings: {},
    configuration: configuration(),
    ...fields,
  };
}

function script(
  id: string,
  fields: Partial<AgentPlanScript> = {},
): AgentPlanScript {
  return {
    id,
    type: "script",
    name: "Script",
    interpreterProfileId: `${WORKSPACE}-bash`,
    content: "echo ok",
    inputs: [],
    outputs: [],
    timeoutSeconds: 60,
    x: 0,
    y: 0,
    bindings: {},
    ...fields,
  };
}

function plan(
  nodes: readonly AgentPlanNode[],
  executionTarget?: AgentPlanExecutionTarget,
): AgentPlanInput {
  return {
    name: "Plan",
    workspaceId: WORKSPACE,
    usage: "private",
    globals: {},
    nodes: [...nodes],
    edges: [],
    ...(executionTarget ? { executionTarget } : {}),
  };
}

function group(id: string, steps: readonly AgentPlanStep[]): AgentPlanNode {
  return {
    id,
    type: "group",
    name: "Group",
    x: 0,
    y: 0,
    steps: [...steps],
    parameters: [],
    bindings: {},
  };
}

function loop(
  id: string,
  steps: readonly (AgentPlanStep | AgentPlanScript)[],
): AgentPlanNode {
  return {
    id,
    type: "loop",
    name: "Loop",
    x: 0,
    y: 0,
    steps: [...steps],
    edges: [],
    runs: 3,
    runsSource: "value",
    countMode: "max",
    sessionPolicy: "reuse",
    condition: null,
    bindings: {},
  };
}

function status(
  fields: Partial<AgentPlanRemoteStatus> = {},
): AgentPlanRemoteStatus {
  return {
    workspaceId: WORKSPACE,
    problem: null,
    tools: [],
    hasModelCatalog: true,
    hasPagesAccess: true,
    ...fields,
  };
}

describe("isSamePlanTarget", () => {
  it("treats a missing target as the Pages host", () => {
    expect(isSamePlanTarget(undefined, undefined)).toBe(true);
    expect(isSamePlanTarget(undefined, LOCAL_PLAN_TARGET)).toBe(true);
    expect(isSamePlanTarget(REMOTE, undefined)).toBe(false);
    expect(isSamePlanTarget(LOCAL_PLAN_TARGET, REMOTE)).toBe(false);
  });

  it("compares remote targets by workspace", () => {
    expect(isSamePlanTarget(REMOTE, { ...REMOTE })).toBe(true);
    expect(isSamePlanTarget(REMOTE, OTHER_REMOTE)).toBe(false);
  });
});

describe("effectivePlanTarget", () => {
  it("lets the own target of a node win over the plan and defaults to the host", () => {
    expect(
      effectivePlanTarget(agent("a", { executionTarget: OTHER_REMOTE }), {
        executionTarget: REMOTE,
      }),
    ).toBe(OTHER_REMOTE);
    expect(effectivePlanTarget(agent("a"), { executionTarget: REMOTE })).toBe(
      REMOTE,
    );
    expect(effectivePlanTarget(agent("a"), {})).toBe(LOCAL_PLAN_TARGET);
  });
});

describe("withInheritedPlanTarget", () => {
  it("returns a local or targetless plan unchanged", () => {
    const local = plan([agent("a")], LOCAL_PLAN_TARGET);
    expect(withInheritedPlanTarget(local)).toBe(local);
    const targetless = plan([agent("a")]);
    expect(withInheritedPlanTarget(targetless)).toBe(targetless);
  });

  it("writes a remote plan target into every node that names none, members of groups and loops included", () => {
    const own = agent("own", { executionTarget: OTHER_REMOTE });
    const inherited = withInheritedPlanTarget(
      plan(
        [
          agent("a"),
          own,
          script("s"),
          group("g", [agent("member")]),
          loop("l", [script("loop-member")]),
          { id: "start", type: "start", x: 0, y: 0 },
        ],
        REMOTE,
      ),
    );
    const targets = inherited.nodes.flatMap((node) => {
      if (node.type === "group" || node.type === "loop")
        return node.steps.map((step) => [step.id, step.executionTarget]);
      return "executionTarget" in node ? [[node.id, node.executionTarget]] : [];
    });
    expect(targets).toEqual([
      ["a", REMOTE],
      ["own", OTHER_REMOTE],
      ["s", REMOTE],
      ["member", REMOTE],
      ["loop-member", REMOTE],
    ]);
    expect(inherited.nodes.at(-1)).toEqual({
      id: "start",
      type: "start",
      x: 0,
      y: 0,
    });
  });
});

describe("planTargetDeviations and withPlanTargetFollowed", () => {
  const deviating = plan([
    agent("same", { executionTarget: REMOTE }),
    agent("other", { executionTarget: OTHER_REMOTE }),
    agent("plain"),
    script("local-script", { executionTarget: LOCAL_PLAN_TARGET }),
    group("g", [agent("member", { executionTarget: OTHER_REMOTE })]),
    loop("l", [script("loop-member", { executionTarget: OTHER_REMOTE })]),
    { id: "end", type: "end", x: 0, y: 0 },
  ]);

  it("lists the nodes whose own target differs from the plan target", () => {
    expect(
      planTargetDeviations(deviating, REMOTE).map((node) => node.id),
    ).toEqual(["other", "local-script", "member", "loop-member"]);
    expect(
      planTargetDeviations(deviating, undefined).map((node) => node.id),
    ).toEqual(["same", "other", "member", "loop-member"]);
  });

  it("makes the named nodes follow the plan again and touches no other", () => {
    const followed = withPlanTargetFollowed(
      deviating,
      new Set(["other", "member", "loop-member"]),
    );
    expect(
      planTargetDeviations(followed, REMOTE).map((node) => node.id),
    ).toEqual(["local-script"]);
    expect(followed.nodes[0]).toBe(deviating.nodes[0]);
    expect(followed.nodes.at(-1)).toBe(deviating.nodes.at(-1));
  });
});

describe("planTargetIssues: containers and local nodes", () => {
  it("reports every member of a group or loop that would run remotely", () => {
    const issues = planTargetIssues(
      plan(
        [
          group("g", [
            agent("in-group"),
            agent("local-member", { executionTarget: LOCAL_PLAN_TARGET }),
          ]),
          loop("l", [script("in-loop")]),
        ],
        REMOTE,
      ),
    );
    expect(issues).toEqual([
      { nodeId: "in-group", problem: "remoteContainer" },
      { nodeId: "in-loop", problem: "remoteContainer" },
    ]);
  });

  it("finds nothing wrong with a plan on the Pages host or with nodes that are no agents", () => {
    expect(
      planTargetIssues(
        plan([
          agent("a"),
          script("s"),
          { id: "start", type: "start", x: 0, y: 0 },
        ]),
      ),
    ).toEqual([]);
  });
});

/** The problems of one agent node on the remote target of its plan, as `node:problem[:port]`. */
const remoteIssues = (
  node: AgentPlanStep,
  remoteStatus?: AgentPlanRemoteStatus,
): readonly string[] =>
  planTargetIssues(
    plan([node], REMOTE),
    remoteStatus ? [remoteStatus] : undefined,
  ).map(
    (issue) =>
      `${issue.nodeId}:${issue.problem}${issue.port ? `:${issue.port}` : ""}`,
  );

describe("planTargetIssues: agents on a remote target", () => {
  const remote = remoteIssues;

  it("takes the problem of the runner before anything else", () => {
    expect(remote(agent("a"), status({ problem: "remoteOffline" }))).toEqual([
      "a:remoteOffline",
    ]);
  });

  it("needs a configuration whose route leads to the target workspace", () => {
    expect(remote(agent("a", { configuration: undefined }))).toEqual([
      "a:remoteModel",
    ]);
    expect(
      remote(agent("a", { configuration: configuration({ hasRoute: false }) })),
    ).toEqual(["a:remoteModel"]);
    expect(
      remote(
        agent("a", {
          configuration: configuration({ workspaceId: OTHER_WORKSPACE }),
        }),
      ),
    ).toEqual(["a:remoteModel"]);
    expect(
      remote(agent("a", { configuration: configuration({ tool: "codex" }) })),
    ).toEqual([]);
  });

  it("checks an API model against the catalog of the runner", () => {
    expect(remote(agent("a"), status({ hasModelCatalog: false }))).toEqual([
      "a:remoteCatalog",
    ]);
    expect(
      remote(
        agent("a"),
        status({ modelIds: ["model-b"], catalogRevision: "rev-1" }),
      ),
    ).toEqual(["a:remoteModel"]);
    expect(
      remote(
        agent("a"),
        status({ modelIds: ["model-a"], catalogRevision: "rev-2" }),
      ),
    ).toEqual(["a:remoteModel"]);
    expect(
      remote(
        agent("a"),
        status({ modelIds: ["model-a"], catalogRevision: "rev-1" }),
      ),
    ).toEqual([]);
  });
});

const codex = (options: ConfigurationOptions = {}): AgentPlanStep =>
  agent("a", {
    configuration: configuration({
      provider: "codex_cli",
      tool: "codex",
      ...options,
    }),
  });

const installed = (
  fields: Partial<AgentPlanRemoteStatus["tools"][number]> = {},
): AgentPlanRemoteStatus["tools"][number] => ({
  tool: "codex",
  version: "1.0.0",
  authentication: "authenticated",
  catalogRevision: "rev-1",
  models: [{ id: "model-a", name: "Model A", reasoningEfforts: [] }],
  ...fields,
});

describe("planTargetIssues: login and catalog of a command line tool", () => {
  const remote = remoteIssues;

  it("blocks a stale tool catalog, a missing tool and an unknown or missing login", () => {
    expect(
      remote(
        codex(),
        status({ isToolCatalogCurrent: false, tools: [installed()] }),
      ),
    ).toEqual(["a:remoteCatalogStale"]);
    expect(remote(codex(), status({ tools: [] }))).toEqual([
      "a:remoteToolMissing",
    ]);
    expect(
      remote(
        codex(),
        status({ tools: [installed({ authentication: "not_logged_in" })] }),
      ),
    ).toEqual(["a:remoteLogin"]);
    expect(
      remote(
        codex(),
        status({ tools: [installed({ authentication: undefined })] }),
      ),
    ).toEqual(["a:remoteLoginUnknown"]);
  });

  it("blocks an empty catalog, an unknown model and a catalog of another revision", () => {
    expect(
      remote(codex(), status({ tools: [installed({ models: [] })] })),
    ).toEqual(["a:remoteCatalog"]);
    expect(
      remote(codex(), status({ tools: [installed({ models: undefined })] })),
    ).toEqual(["a:remoteCatalog"]);
    expect(
      remote(codex({ model: "model-z" }), status({ tools: [installed()] })),
    ).toEqual(["a:remoteModel"]);
    expect(
      remote(
        codex(),
        status({ tools: [installed({ catalogRevision: "rev-9" })] }),
      ),
    ).toEqual(["a:remoteModel"]);
  });
});

describe("planTargetIssues: options and OpenCode of a command line tool", () => {
  const remote = remoteIssues;

  it("blocks options a runner does not offer: writing into the workspace or a browser", () => {
    const write = {
      ...DEFAULT_AGENT_RUN_OPTIONS,
      access: "workspace_write" as const,
    };
    const browser = { ...DEFAULT_AGENT_RUN_OPTIONS, browser: true };
    expect(
      remote(codex({ run: write }), status({ tools: [installed()] })),
    ).toEqual(["a:remoteOptions"]);
    expect(
      remote(codex({ run: browser }), status({ tools: [installed()] })),
    ).toEqual(["a:remoteOptions"]);
    expect(remote(codex(), status({ tools: [installed()] }))).toEqual([]);
  });

  it("needs a runner that drives OpenCode over ACP with a compatible contract", () => {
    const opencode = agent("a", {
      configuration: configuration({
        provider: "opencode",
        tool: "opencode",
      }),
    });
    const tool = installed({ tool: "opencode" });
    expect(remote(opencode, status({ tools: [tool] }))).toEqual([
      "a:remoteRunnerUpdate",
    ]);
    expect(
      remote(
        opencode,
        status({
          hasOpenCodeAccess: true,
          tools: [
            {
              ...tool,
              acp: { status: "incompatible", reason: "protocol_mismatch" },
            },
          ],
        }),
      ),
    ).toEqual(["a:remoteToolIncompatible"]);
    expect(
      remote(opencode, status({ hasOpenCodeAccess: true, tools: [tool] })),
    ).toEqual([]);
  });
});

describe("planTargetIssues: ticket, wiki and workspace parameters", () => {
  const remote = remoteIssues;
  const withParameters = (options: ConfigurationOptions = {}): AgentPlanStep =>
    agent("a", {
      configuration: configuration({
        parameterTypes: ["ticket", "text", "wiki", "workspace"],
        tool: "claude",
        provider: "claude_code",
        ...options,
      }),
    });

  it("names each remote resource port when Pages cannot be reached from the runner", () => {
    const claude = status({
      tools: [
        {
          tool: "claude",
          version: "1.0.0",
          authentication: "authenticated",
          catalogRevision: "rev-1",
          models: [{ id: "model-a", name: "Model A", reasoningEfforts: [] }],
        },
      ],
    });
    expect(
      remote(withParameters(), { ...claude, hasPagesAccess: false }),
    ).toEqual([
      "a:remoteRunnerUpdate:ticket0",
      "a:remoteRunnerUpdate:wiki2",
      "a:remoteRunnerUpdate:workspace3",
    ]);
    expect(remote(withParameters(), claude)).toEqual([]);
  });

  it("reports a runner problem on every resource port as well", () => {
    expect(
      remote(withParameters(), status({ problem: "remoteOffline" })),
    ).toEqual([
      "a:remoteOffline",
      "a:remoteOffline:ticket0",
      "a:remoteOffline:wiki2",
      "a:remoteOffline:workspace3",
    ]);
  });

  it("needs a command line tool route to reach Pages when no runner status is known", () => {
    const parameterTypes = ["ticket"] as const;
    // An API model of the runner cannot read Pages resources.
    expect(
      remote(
        agent("a", {
          configuration: configuration({ parameterTypes }),
        }),
      ),
    ).toEqual(["a:remotePagesUnavailable:ticket0"]);
    expect(
      remote(
        agent("a", {
          configuration: configuration({
            parameterTypes,
            provider: "codex_cli",
            tool: "codex",
          }),
        }),
      ),
    ).toEqual([]);
  });
});

describe("planTargetIssues: scripts on a remote target", () => {
  const remote = (
    node: AgentPlanScript,
    remoteStatus?: AgentPlanRemoteStatus,
  ): readonly string[] =>
    planTargetIssues(
      plan([node], REMOTE),
      remoteStatus ? [remoteStatus] : undefined,
    ).map((issue) => `${issue.nodeId}:${issue.problem}`);

  it("takes an interpreter the runner names after the workspace", () => {
    expect(remote(script("s"))).toEqual([]);
    expect(remote(script("s", { interpreterProfileId: "bash" }))).toEqual([
      "s:remoteInterpreter",
    ]);
  });

  it("checks the interpreters the runner reports", () => {
    expect(
      remote(script("s"), status({ interpreterIds: [`${WORKSPACE}-bash`] })),
    ).toEqual([]);
    expect(remote(script("s"), status({ interpreterIds: ["other"] }))).toEqual([
      "s:remoteInterpreter",
    ]);
    expect(
      remote(
        script("s"),
        status({ removedInterpreterIds: [`${WORKSPACE}-bash`] }),
      ),
    ).toEqual(["s:remoteInterpreterRemoved"]);
  });
});

describe("scriptLocalPaths", () => {
  it("names the absolute home and mount paths of the host, at most three", () => {
    const content = [
      'cd "/home/igor/project"',
      "cp ~/notes.txt /srv/share/out",
      "ls /opt/tools && cat /root/secret",
      "echo /home/igor/project",
    ].join("\n");
    expect(scriptLocalPaths({ content })).toEqual([
      "/home/igor/project",
      "~/notes.txt",
      "/srv/share/out",
    ]);
  });

  it("ignores relative paths, system paths and urls", () => {
    expect(
      scriptLocalPaths({
        content: "cat ./a && ls /usr/bin https://example.test/home/x",
      }),
    ).toEqual([]);
  });
});
