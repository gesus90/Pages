import { describe, expect, it } from "vitest";

import {
  readPlanBinding,
  readPlanInput,
  readPlanNode,
  readPlanText,
} from "@/backend/agents/AgentPlanInput";
import { AgentError } from "@/backend/error/AgentErrors";

const POS = { x: 1, y: 2 };
const GATE = { version: 1, requiredChecks: ["lint"] };
const TEXT = { type: "text", text: "x" };

function codeOf(action: () => unknown): string | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof AgentError ? error.code : "other";
  }
  return undefined;
}

function expectCode<T>(
  code: string,
  cases: readonly T[],
  build: (input: T) => unknown,
): void {
  for (const input of cases) expect(codeOf(() => build(input))).toBe(code);
}

function node(fields: Record<string, unknown>): Record<string, unknown> {
  return { id: "n", ...POS, ...fields };
}

function step(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return node({
    type: "agent",
    agentId: "a",
    personalAgentId: null,
    instruction: "do",
    bindings: {},
    ...fields,
  });
}

function script(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return node({
    type: "script",
    name: " s ",
    interpreterProfileId: "bash",
    content: "echo",
    inputs: [],
    outputs: [],
    timeoutSeconds: 60,
    bindings: {},
    ...fields,
  });
}

function loop(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return node({
    type: "loop",
    name: "l",
    steps: [],
    edges: [],
    runs: 2,
    runsSource: "value",
    countMode: "max",
    sessionPolicy: "reuse",
    condition: null,
    bindings: {},
    ...fields,
  });
}

function group(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return node({
    type: "group",
    name: "g",
    steps: [],
    parameters: [],
    bindings: {},
    ...fields,
  });
}

describe("readPlanText", () => {
  it("trims valid text and rejects the rest", () => {
    expect(readPlanText(" a ")).toBe("a");
    for (const bad of [1, "  ", "a".repeat(101), "a\u0001"])
      expect(codeOf(() => readPlanText(bad))).toBe("plan_invalid");
    expect(readPlanText("a".repeat(101), 200)).toHaveLength(101);
  });
});

describe("readPlanBinding", () => {
  it("reads every binding kind", () => {
    const bindings = [
      { kind: "literal", value: null },
      { kind: "literal", value: TEXT },
      { kind: "source", nodeId: "n" },
      { kind: "result", stepId: "s" },
      { kind: "previous", stepId: "s" },
      { kind: "port", nodeId: "n", port: "p" },
      { kind: "stack", stackId: "s", output: "count" },
    ];
    for (const binding of bindings)
      expect(readPlanBinding(binding)).toEqual(binding);
  });

  it("rejects unknown kinds, extra keys and bad stack outputs", () => {
    expect(codeOf(() => readPlanBinding({ kind: "x" }))).toBe("plan_invalid");
    expect(
      codeOf(() => readPlanBinding({ kind: "source", nodeId: "n", extra: 1 })),
    ).toBe("plan_binding_invalid");
    expect(
      codeOf(() =>
        readPlanBinding({ kind: "stack", stackId: "s", output: "x" }),
      ),
    ).toBe("plan_binding_invalid");
  });
});

describe("readPlanNode basics", () => {
  it("rejects a bad position and non-objects", () => {
    expect(codeOf(() => readPlanNode("x"))).toBe("plan_invalid");
    const xs: readonly unknown[] = ["1", 1.5, -1, 6001];
    expectCode("plan_invalid", xs, (x) => readPlanNode(step({ x })));
    expectCode("plan_invalid", xs, (y) => readPlanNode(step({ y })));
  });

  it("rejects too many or badly named bindings", () => {
    const many = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [
        `p${index}`,
        { kind: "literal", value: null },
      ]),
    );
    expect(codeOf(() => readPlanNode(step({ bindings: many })))).toBe(
      "plan_invalid",
    );
    expect(
      codeOf(() =>
        readPlanNode(
          step({ bindings: { "bad name!": { kind: "literal", value: null } } }),
        ),
      ),
    ).toBe("plan_invalid");
    expect(
      readPlanNode(step({ bindings: { ok: { kind: "source", nodeId: "z" } } })),
    ).toMatchObject({ bindings: { ok: { kind: "source", nodeId: "z" } } });
  });

  it("dispatches to the specialised node readers", () => {
    expect(readPlanNode(node({ type: "task", taskId: "t" }))).toMatchObject({
      type: "task",
      taskId: "t",
    });
    expect(readPlanNode(node({ type: "task", taskId: "" }))).toMatchObject({
      taskId: "",
    });
    expect(readPlanNode(node({ type: "variable", name: "abc" }))).toMatchObject(
      { type: "variable", name: "abc" },
    );
    expect(
      codeOf(() => readPlanNode(node({ type: "variable", name: "bad name" }))),
    ).toBe("plan_invalid");
    expect(readPlanNode(node({ type: "decision" })).type).toBe("decision");
    expect(
      readPlanNode(node({ type: "asset", name: "a", file: null })),
    ).toMatchObject({ type: "asset", file: null });
    expect(codeOf(() => readPlanNode(node({ type: "swarm" })))).toBe(
      "swarm_invalid",
    );
    expect(
      readPlanNode(node({ type: "start", name: "s", inputs: [] })).type,
    ).toBe("start");
  });
});

describe("agent step", () => {
  it("reads a full step", () => {
    const parsed = readPlanNode(
      step({
        selectionRequired: "model",
        agentId: "",
        personalAgentId: " p ",
        completionGate: GATE,
        role: "closeout",
        executionTarget: { kind: "local" },
        completion: "todos",
        configuration: {
          name: "",
          revision: 1,
          modelProfileId: "",
          model: "",
          provider: null,
          reasoningEffort: null,
          template: { markdown: "", parameters: [], directoryParameter: null },
        },
      }),
    );
    expect(parsed).toMatchObject({
      type: "agent",
      selectionRequired: "model",
      agentId: "",
      personalAgentId: "p",
      role: "closeout",
      completion: "todos",
      executionTarget: { kind: "local" },
    });
  });

  it("reads the plain step defaults", () => {
    const parsed = readPlanNode(
      step({
        selectionRequired: "agent",
        personalAgentId: "",
        role: null,
        completion: "report",
      }),
    );
    expect(parsed).toMatchObject({ personalAgentId: "" });
    expect(parsed).not.toHaveProperty("completion");
    expect(parsed).not.toHaveProperty("role");
  });

  it("rejects malformed steps", () => {
    expect(codeOf(() => readPlanNode(step({ instruction: 1 })))).toBe(
      "plan_invalid",
    );
    expect(
      codeOf(() => readPlanNode(step({ instruction: "a".repeat(200001) }))),
    ).toBe("plan_invalid");
    expect(codeOf(() => readPlanNode(step({ role: "x" })))).toBe(
      "plan_invalid",
    );
    expect(codeOf(() => readPlanNode(step({ completion: "x" })))).toBe(
      "plan_invalid",
    );
    expect(codeOf(() => readPlanNode(step({ executionTarget: {} })))).toBe(
      "plan_invalid",
    );
    expect(codeOf(() => readPlanNode(node({ type: "nope" })))).toBe(
      "plan_invalid",
    );
  });
});

describe("script node", () => {
  it("reads a full script", () => {
    const parsed = readPlanNode(
      script({
        executionTarget: { kind: "remote", workspaceId: "w" },
        role: "closeout",
        inputs: [{ name: "a", type: "text", isRequired: true }],
        outputs: [{ name: "b", type: "text" }],
        disabled: true,
        disabledOutput: "skipped",
      }),
    );
    expect(parsed).toMatchObject({
      type: "script",
      name: "s",
      disabled: true,
      disabledOutput: "skipped",
      inputs: [{ name: "a", type: "text", isRequired: true }],
    });
  });

  it("keeps the report policy of an output", () => {
    expect(
      readPlanNode(
        script({ outputs: [{ name: "b", type: "text", policy: "gate" }] }),
      ),
    ).toMatchObject({ outputs: [{ name: "b", type: "text", policy: "gate" }] });
  });

  it("drops blank disabled output and a false disabled flag", () => {
    const parsed = readPlanNode(
      script({ disabled: false, disabledOutput: "  " }),
    );
    expect(parsed).not.toHaveProperty("disabled");
    expect(parsed).not.toHaveProperty("disabledOutput");
  });

  it("rejects malformed scripts", () => {
    const bad: Record<string, unknown>[] = [
      { name: 1 },
      { interpreterProfileId: 1 },
      { content: 1 },
      { timeoutSeconds: "1" },
      { disabled: "x" },
      { disabledOutput: 1 },
      { disabledOutput: "a".repeat(100001) },
      { inputs: "x" },
      { inputs: Array.from({ length: 65 }, () => ({})) },
      { inputs: [{ name: 1, type: "text", isRequired: true }] },
      { inputs: [{ name: "a", type: "x", isRequired: true }] },
      { inputs: [{ name: "a", type: "text", isRequired: "x" }] },
      { outputs: [{ name: "a", type: "text", policy: "x" }] },
      {
        outputs: [
          { name: "a", type: "text", policy: "report" },
          { name: "b", type: "text" },
        ],
      },
      { content: "  " },
    ];
    expectCode("plan_script_invalid", bad, (fields) =>
      readPlanNode(script(fields)),
    );
  });
});

describe("git closeout node", () => {
  it("reads a stored closeout and rejects a malformed one", () => {
    const closeout = node({
      type: "git_closeout",
      name: "n",
      checkCommand: "c",
      timeoutSeconds: 5,
      bindings: {},
    });
    expect(readPlanNode(closeout)).toMatchObject({
      type: "git_closeout",
      role: "closeout",
    });
    expect(codeOf(() => readPlanNode({ ...closeout, name: 1 }))).toBe(
      "plan_invalid",
    );
    expect(codeOf(() => readPlanNode({ ...closeout, checkCommand: 1 }))).toBe(
      "plan_invalid",
    );
    expect(
      codeOf(() => readPlanNode({ ...closeout, timeoutSeconds: "1" })),
    ).toBe("plan_invalid");
  });
});

describe("parameter and stack nodes", () => {
  const parameter = node({
    type: "parameter",
    name: "p",
    format: "string",
    value: TEXT,
  });

  it("reads a parameter for every format", () => {
    expect(readPlanNode(parameter)).toMatchObject({ format: "string" });
    for (const format of ["number", "json", "boolean"])
      expect(
        codeOf(() => readPlanNode({ ...parameter, format, value: TEXT })),
      ).not.toBe("plan_invalid");
  });

  it("rejects a bad parameter", () => {
    expect(codeOf(() => readPlanNode({ ...parameter, format: "x" }))).toBe(
      "plan_invalid",
    );
    expect(codeOf(() => readPlanNode({ ...parameter, name: "a b" }))).toBe(
      "plan_invalid",
    );
  });

  it("reads stack entries of every type", () => {
    const file = {
      assetId: "a",
      fileName: "f.png",
      mediaType: "image/png",
      kind: "image",
      size: 1,
      digest: "a".repeat(64),
    };
    const parsed = readPlanNode(
      node({
        type: "stack",
        name: "s",
        entries: [
          { id: "1", type: "task", taskId: "t" },
          { id: "2", type: "asset", file },
          {
            id: "3",
            type: "parameter",
            name: "p",
            format: "string",
            value: TEXT,
          },
        ],
      }),
    );
    expect(parsed).toMatchObject({
      type: "stack",
      entries: [{ type: "task" }, { type: "asset" }, { type: "parameter" }],
    });
  });

  it("rejects malformed stacks", () => {
    const stack = (entries: unknown): unknown =>
      node({ type: "stack", name: "s", entries });
    const bad: unknown[] = [
      "x",
      Array.from({ length: 1000 }, () => ({})),
      [{ id: "1", type: "task", taskId: "t", extra: 1 }],
      [{ id: "1", type: "asset", file: {}, extra: 1 }],
      [{ id: "1", type: "other" }],
      [
        { id: "1", type: "task", taskId: "t" },
        { id: "1", type: "task", taskId: "u" },
      ],
    ];
    expectCode("plan_stack_invalid", bad, (entries) =>
      readPlanNode(stack(entries)),
    );
  });
});

describe("group node", () => {
  it("reads a group with edges, loops, decisions and parameters", () => {
    const parsed = readPlanNode(
      group({
        steps: [step({ id: "s1" })],
        loops: [loop({ id: "l1", steps: [step({ id: "s2" })] })],
        edges: [
          { from: "a", to: "b" },
          { kind: "flow", from: "a", to: "b", fromPort: "x", toPort: "y" },
        ],
        decisions: [node({ id: "d", type: "decision" })],
        parameters: [
          {
            id: "pp",
            name: "p",
            type: "text",
            description: "",
            isRequired: false,
            defaultValue: null,
          },
        ],
      }),
    );
    expect(parsed).toMatchObject({
      type: "group",
      edges: [
        { fromPort: "flow-out", toPort: "flow-in" },
        { fromPort: "x", toPort: "y" },
      ],
    });
  });

  it("reads a plain group", () => {
    expect(readPlanNode(group())).not.toHaveProperty("edges");
  });

  it("rejects malformed groups", () => {
    const bad: Record<string, unknown>[] = [
      { steps: "x" },
      { steps: Array.from({ length: 51 }, () => ({})) },
      { parameters: "x" },
      { parameters: Array.from({ length: 65 }, () => ({})) },
      { steps: [script()] },
      { steps: [step({ role: "closeout" })] },
      { edges: "x" },
      { edges: Array.from({ length: 101 }, () => ({})) },
      { edges: [{ kind: "x", from: "a", to: "b" }] },
      { loops: "x" },
      { loops: Array.from({ length: 51 }, () => ({})) },
      { loops: [node({ type: "agent" })] },
      { loops: [{ ...loop(), steps: "x", type: "loop" }] },
      { decisions: [step()] },
    ];
    expectCode("plan_invalid", bad, (fields) => readPlanNode(group(fields)));
    expect(
      codeOf(() =>
        readPlanNode(group({ loops: [loop({ steps: [group()] })] })),
      ),
    ).toBe("plan_loop_nested");
    expect(
      codeOf(() =>
        readPlanNode(
          group({
            steps: [step({ completionGate: GATE })],
          }),
        ),
      ),
    ).toBe("plan_work_gate_unavailable");
  });
});

describe("loop node", () => {
  it("reads a loop with members, mode and while", () => {
    const parsed = readPlanNode(
      loop({
        steps: [step({ id: "s" }), script({ id: "c" }), group({ id: "g" })],
        decisions: [node({ id: "d", type: "decision" })],
        mode: "while",
        while: { sourceNodeId: "s", outputPath: "" },
      }),
    );
    expect(parsed).toMatchObject({
      type: "loop",
      mode: "while",
      while: { sourceNodeId: "s", outputPath: "" },
    });
  });

  it("reads a plain loop", () => {
    const parsed = readPlanNode(loop());
    expect(parsed).not.toHaveProperty("mode");
    expect(parsed).not.toHaveProperty("while");
  });

  it("rejects malformed loops", () => {
    const invalid: Record<string, unknown>[] = [
      { steps: "x" },
      { steps: Array.from({ length: 51 }, () => ({})) },
      { countMode: "x" },
      { sessionPolicy: "x" },
      { runsSource: "x" },
      { mode: "x" },
      { steps: [node({ type: "task", taskId: "t" })] },
    ];
    expectCode("plan_loop_invalid", invalid, (fields) =>
      readPlanNode(loop(fields)),
    );
    expect(codeOf(() => readPlanNode(loop({ runs: 0 })))).toBe(
      "plan_loop_runs_invalid",
    );
    const nested: Record<string, unknown>[] = [
      { steps: [loop()] },
      {
        steps: [group({ loops: [loop()] })],
      },
    ];
    expectCode("plan_loop_nested", nested, (fields) =>
      readPlanNode(loop(fields)),
    );
    expect(
      codeOf(() =>
        readPlanNode(
          loop({
            steps: [step({ completionGate: GATE })],
          }),
        ),
      ),
    ).toBe("plan_work_gate_unavailable");
    expect(
      codeOf(() => readPlanNode(loop({ steps: [step({ role: "closeout" })] }))),
    ).toBe("plan_invalid");
    expect(
      codeOf(() =>
        readPlanNode(loop({ steps: [script({ role: "closeout" })] })),
      ),
    ).toBe("plan_invalid");
  });
});

describe("readPlanInput", () => {
  const plan = {
    name: " Plan ",
    workspaceId: "w",
    usage: "private",
    globals: {},
    nodes: [],
    edges: [],
  };

  it("reads a minimal plan", () => {
    expect(readPlanInput(plan)).toEqual({
      name: "Plan",
      workspaceId: "w",
      usage: "private",
      globals: {},
      nodes: [],
      edges: [],
    });
  });

  it("reads a plan with every optional part", () => {
    const parsed = readPlanInput({
      ...plan,
      usage: "workspace",
      workspaceId: "",
      projectId: "p",
      sharing: { isGlobal: true, targets: [] },
      executionTarget: { kind: "local" },
      oneShot: true,
      revision: 3,
      globals: { g: "v" },
      nodes: [step()],
      edges: [{ from: "a", to: "b" }],
    });
    expect(parsed).toMatchObject({
      projectId: "p",
      oneShot: true,
      revision: 3,
      sharing: { isGlobal: true, operator: "or" },
    });
  });

  it("rejects malformed plans", () => {
    const bad: Record<string, unknown>[] = [
      { nodes: "x" },
      { nodes: Array.from({ length: 100000 }, () => ({})) },
      { edges: "x" },
      { edges: Array.from({ length: 501 }, () => ({})) },
      { usage: "x" },
      { revision: "1" },
      { revision: 1.5 },
      { revision: 0 },
    ];
    expectCode("plan_invalid", bad, (fields) =>
      readPlanInput({ ...plan, ...fields }),
    );
  });

  it("rejects a plan whose contained nodes exceed the limit", () => {
    const members = Array.from({ length: 50 }, (_, index) =>
      step({ id: `m${index}` }),
    );
    const loops = Array.from({ length: 50 }, (_, index) =>
      loop({ id: `l${index}`, steps: members }),
    );
    const groups = Array.from({ length: 50 }, (_, index) =>
      group({ id: `g${index}`, steps: members }),
    );
    expect(
      codeOf(() =>
        readPlanInput({ ...plan, nodes: [...loops, ...groups].slice(0, 100) }),
      ),
    ).toBe("plan_invalid");
  });
});
