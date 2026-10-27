import { describe, expect, it } from "vitest";

import { DEFAULT_AGENT_RUN_OPTIONS } from "@/definition/AgentConfiguration";
import {
  allPlanSteps,
  expandPlanGroups,
  hasPlanGroupAliases,
  mapPlanSteps,
  planGroupAdapter,
  planGroupEdges,
  planGroupEntries,
  planGroupExits,
  planGroupOrder,
  planGroupRefusal,
  planMemberProviderRefusal,
  planNodeParameters,
  planStepAdapter,
  planStepProvider,
  resolvePlanGroupBinding,
} from "@/definition/AgentPlanGroup";

import { agent, edge, groupOf, loopOf, planOf, script } from "./plan-fixtures";

import type { AgentDefinitionChoice } from "@/definition/AgentAvailability";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type { AgentParameter } from "@/definition/AgentParameters";
import type { AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";

function choice(
  id: string,
  provider: AgentProviderId | null,
  parameters: AgentParameter[] = [],
): AgentDefinitionChoice {
  return {
    id,
    name: id,
    model: "model",
    reasoningEffort: null,
    provider,
    purposes: [],
    revision: 1,
    configuration: {
      scope: "person",
      tag: "",
      markdown: "",
      projectId: null,
      accessMode: "personal",
      parameters,
      directoryParameter: null,
      run: DEFAULT_AGENT_RUN_OPTIONS,
    },
    availability: { isUsable: true, reason: null, personalChoices: [] },
  };
}

/** An agent node that names the given source agent. */
function stepOf(id: string, agentId: string): AgentPlanStep {
  return { ...agent(id), agentId };
}

const AGENTS = [
  choice("codex", "codex_cli"),
  choice("claude", "claude_code"),
  choice("api", "openrouter"),
  choice("unknown-provider", null),
  choice("with-inputs", "claude_code", [
    {
      name: "topic",
      type: "text",
      description: "",
      isRequired: true,
      defaultValue: null,
    },
  ]),
];

describe("the provider of an agent node", () => {
  it("prefers the pinned configuration, then the source agent, else nothing", () => {
    const pinned: AgentPlanStep = {
      ...stepOf("a", "codex"),
      configuration: {
        name: "n",
        revision: 1,
        modelProfileId: "m",
        model: "m",
        provider: "claude_code",
        reasoningEffort: null,
        template: {
          markdown: "",
          parameters: [],
          directoryParameter: null,
          run: DEFAULT_AGENT_RUN_OPTIONS,
        },
      },
    };

    expect(planStepProvider(pinned, AGENTS)).toBe("claude_code");
    expect(planStepProvider(stepOf("a", "codex"), AGENTS)).toBe("codex_cli");
    expect(planStepProvider(stepOf("a", "gone"), AGENTS)).toBeNull();
    expect(
      planStepProvider(stepOf("a", "unknown-provider"), AGENTS),
    ).toBeNull();
  });

  it("names the ACP adapter only for ACP providers", () => {
    expect(planStepAdapter(stepOf("a", "codex"), AGENTS)).toBe("codex_cli");
    expect(planStepAdapter(stepOf("a", "api"), AGENTS)).toBeNull();
    expect(planStepAdapter(stepOf("a", "gone"), AGENTS)).toBeNull();
  });
});

describe("groups and their adapter class", () => {
  it("takes the class of the first member and is neutral without members", () => {
    expect(
      planGroupAdapter(
        groupOf("g", [stepOf("a", "claude"), stepOf("b", "codex")]),
        AGENTS,
      ),
    ).toBe("claude_code");
    expect(planGroupAdapter(groupOf("g", []), AGENTS)).toBeNull();
  });

  it("refuses a node that has no agent, is no ACP agent or has another adapter", () => {
    const group = groupOf("g", [stepOf("a", "claude")]);

    expect(planGroupRefusal(group, stepOf("n", "gone"), AGENTS)).toBe(
      "missingAgent",
    );
    expect(planGroupRefusal(group, stepOf("n", "api"), AGENTS)).toBe("notAcp");
    expect(planGroupRefusal(group, stepOf("n", "codex"), AGENTS)).toBe(
      "otherAdapter",
    );
    expect(planGroupRefusal(group, stepOf("n", "claude"), AGENTS)).toBeNull();
  });

  it("lets the first member decide the class and a neutral group take any ACP agent", () => {
    const group = groupOf("g", [stepOf("a", "claude")]);

    expect(planGroupRefusal(group, stepOf("a", "claude"), AGENTS)).toBeNull();
    expect(
      planGroupRefusal(groupOf("g", []), stepOf("n", "codex"), AGENTS),
    ).toBeNull();
  });

  it("checks a provider change against the other members only", () => {
    const group = groupOf("g", [stepOf("a", "claude"), stepOf("b", "claude")]);

    expect(planMemberProviderRefusal(group, "a", "openrouter", AGENTS)).toBe(
      "notAcp",
    );
    expect(planMemberProviderRefusal(group, "a", "codex_cli", AGENTS)).toBe(
      "otherAdapter",
    );
    expect(
      planMemberProviderRefusal(group, "a", "claude_code", AGENTS),
    ).toBeNull();
    expect(
      planMemberProviderRefusal(
        groupOf("g", [stepOf("a", "claude")]),
        "a",
        "codex_cli",
        AGENTS,
      ),
    ).toBeNull();
    expect(
      planMemberProviderRefusal(
        groupOf("g", [stepOf("a", "claude"), stepOf("b", "gone")]),
        "a",
        "codex_cli",
        AGENTS,
      ),
    ).toBeNull();
  });
});

describe("the flow inside a group", () => {
  const chain = groupOf("g", [agent("a"), agent("b"), agent("c")]);
  const explicit = { ...chain, edges: [edge("a", "c"), edge("a", "b")] };

  it("reads a legacy group as the chain of its members", () => {
    expect(planGroupEdges(chain)).toEqual([
      { from: "a", to: "b", fromPort: "flow-out", toPort: "flow-in" },
      { from: "b", to: "c", fromPort: "flow-out", toPort: "flow-in" },
    ]);
    expect(planGroupEdges(groupOf("g", []))).toEqual([]);
  });

  it("uses the saved edges when the group has them", () => {
    expect(planGroupEdges(explicit)).toBe(explicit.edges);
    expect(planGroupEntries(explicit).map((step) => step.id)).toEqual(["a"]);
    expect(planGroupExits(explicit).map((step) => step.id)).toEqual(["b", "c"]);
    expect(planGroupEntries(chain).map((step) => step.id)).toEqual(["a"]);
    expect(planGroupExits(chain).map((step) => step.id)).toEqual(["c"]);
  });

  it("orders a group that is one chain and refuses any other shape", () => {
    expect(planGroupOrder(chain)?.map((step) => step.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(
      planGroupOrder(groupOf("g", [agent("a")]))?.map((step) => step.id),
    ).toEqual(["a"]);
    // Two entries, a fork, a cycle and a member outside the chain are no chain.
    expect(
      planGroupOrder({ ...groupOf("g", [agent("a"), agent("b")]), edges: [] }),
    ).toBeNull();
    expect(planGroupOrder(explicit)).toBeNull();
    expect(
      planGroupOrder({
        ...chain,
        edges: [edge("a", "b"), edge("b", "c"), edge("c", "b")],
      }),
    ).toBeNull();
    expect(planGroupOrder({ ...chain, edges: [edge("a", "b")] })).toBeNull();
    // One entry, but the members c and d only reach each other.
    expect(
      planGroupOrder({
        ...groupOf("g", [agent("a"), agent("b"), agent("c"), agent("d")]),
        edges: [edge("a", "b"), edge("c", "d"), edge("d", "c")],
      }),
    ).toBeNull();
    expect(
      planGroupOrder({ ...chain, edges: [edge("a", "ghost")] }),
    ).toBeNull();
    expect(planGroupOrder(groupOf("g", []))).toBeNull();
  });
});

describe("changing and expanding groups", () => {
  it("maps the agent nodes on the grid, in groups and in loops, and leaves scripts alone", () => {
    const plan = planOf([
      agent("outer"),
      script("s"),
      groupOf("g", [agent("grouped")]),
      loopOf("l", [agent("looped"), script("loop-script")]),
      {
        id: "p",
        type: "parameter",
        name: "p",
        format: "string",
        value: { type: "text", text: "" },
        x: 0,
        y: 0,
      },
    ]);

    const mapped = mapPlanSteps(plan, (step) => ({
      ...step,
      instruction: `seen ${step.id}`,
    }));

    const instructions = allPlanSteps(mapped).map((step) => step.instruction);
    expect(instructions).toEqual(["seen outer", "seen grouped", "seen looped"]);
    expect(mapped.nodes[1]).toBe(plan.nodes[1]);
    expect(mapped.nodes[4]).toBe(plan.nodes[4]);
  });

  it("replaces groups by their members and adds the edges inside each group", () => {
    const plan = planOf(
      [
        agent("before"),
        groupOf("g", [agent("a"), agent("b")]),
        script("after"),
      ],
      [edge("before", "a"), edge("b", "after")],
    );

    const expanded = expandPlanGroups(plan);

    expect(expanded.nodes.map((node) => node.id)).toEqual([
      "before",
      "a",
      "b",
      "after",
    ]);
    expect(expanded.edges.map((entry) => `${entry.from}>${entry.to}`)).toEqual([
      "before>a",
      "b>after",
      "a>b",
    ]);
    expect(expandPlanGroups(planOf([agent("solo")])).edges).toEqual([]);
  });
});

describe("agent nodes of a plan", () => {
  it("lists agents on the grid, in groups and in loops, but no scripts", () => {
    const plan = planOf([
      agent("outer"),
      script("s"),
      groupOf("g", [agent("grouped")]),
      loopOf("l", [agent("looped"), script("loop-script")]),
    ]);

    expect(allPlanSteps(plan).map((step) => step.id)).toEqual([
      "outer",
      "grouped",
      "looped",
    ]);
  });
});

describe("the inputs at a node boundary", () => {
  it("lists the declared inputs of an agent, the inputs of a script and none for a group", () => {
    const withInputs = stepOf("a", "with-inputs");

    expect(
      planNodeParameters(withInputs, AGENTS).map((parameter) => parameter.name),
    ).toEqual(["topic"]);
    expect(planNodeParameters(stepOf("a", "gone"), AGENTS)).toEqual([]);
    expect(
      planNodeParameters(
        {
          ...script("s"),
          inputs: [{ name: "in", type: "text", isRequired: false }],
        },
        AGENTS,
      ).map((parameter) => parameter.name),
    ).toEqual(["in"]);
    expect(planNodeParameters(groupOf("g", []), AGENTS)).toEqual([]);
    expect(
      planNodeParameters(
        {
          id: "p",
          type: "parameter",
          name: "p",
          format: "string",
          value: { type: "text", text: "" },
          x: 0,
          y: 0,
        },
        AGENTS,
      ),
    ).toEqual([]);
  });
});

describe("historical input aliases of a group", () => {
  const port = {
    id: "port-1",
    name: "topic",
    type: "text" as const,
    description: "",
    isRequired: false,
    defaultValue: { type: "text" as const, text: "fallback" },
  };
  const group: AgentPlanGroup = {
    ...groupOf("g", [
      {
        ...agent("a"),
        bindings: { topic: { kind: "source", nodeId: "port-1" } },
      },
    ]),
    parameters: [port],
    bindings: {
      topic: { kind: "literal", value: { type: "text", text: "bound" } },
    },
  };

  it("resolves an alias to the binding of the group, or to the default of its port", () => {
    const alias = { kind: "source" as const, nodeId: "port-1" };

    expect(resolvePlanGroupBinding(alias, group, planOf([group]))).toEqual(
      group.bindings.topic,
    );
    expect(
      resolvePlanGroupBinding(
        alias,
        { ...group, bindings: {} },
        planOf([group]),
      ),
    ).toEqual({
      kind: "literal",
      value: port.defaultValue,
    });
  });

  it("keeps a binding that is no alias, an unknown alias and an ambiguous one", () => {
    const literal = { kind: "literal" as const, value: null };
    const unknown = { kind: "source" as const, nodeId: "elsewhere" };
    const alias = { kind: "source" as const, nodeId: "port-1" };
    const duplicate = {
      ...group,
      parameters: [port, { ...port, id: "port-2" }],
    };
    const taken = planOf([group, agent("port-1")]);

    expect(resolvePlanGroupBinding(literal, group, planOf([group]))).toBe(
      literal,
    );
    expect(resolvePlanGroupBinding(unknown, group, planOf([group]))).toBe(
      unknown,
    );
    expect(resolvePlanGroupBinding(alias, group, taken)).toBe(alias);
    expect(
      resolvePlanGroupBinding(
        { kind: "source", nodeId: "port-1" },
        duplicate,
        planOf([duplicate]),
      ),
    ).toEqual({
      kind: "source",
      nodeId: "port-1",
    });
    expect(
      resolvePlanGroupBinding(
        alias,
        { ...group, parameters: [port, { ...port, id: "port-1" }] },
        planOf([group]),
      ),
    ).toEqual(alias);
  });

  it("knows whether a member still reads an alias that needs repair", () => {
    expect(hasPlanGroupAliases(group)).toBe(true);
    expect(hasPlanGroupAliases({ ...group, parameters: [] })).toBe(false);
    expect(hasPlanGroupAliases(groupOf("g", [agent("a")]))).toBe(false);
  });
});
