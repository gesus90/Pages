/** A canvas position inside the plan bounds. */
export const POSITION = { x: 10, y: 20 } as const;

/** Fields of a synthetic plan node, as a client submits them. */
export type NodeFields = Readonly<Record<string, unknown>>;

/** Builds a valid agent node with the given changes. */
export function agentNode(changes: NodeFields = {}): NodeFields {
  return {
    id: "a1",
    ...POSITION,
    type: "agent",
    agentId: "agent-1",
    personalAgentId: null,
    instruction: "Review the ticket.",
    bindings: {},
    ...changes,
  };
}

/** Builds a valid script node with one input and one output. */
export function scriptNode(changes: NodeFields = {}): NodeFields {
  return {
    id: "s1",
    ...POSITION,
    type: "script",
    name: " Count ",
    interpreterProfileId: "python",
    content: "print(1)",
    timeoutSeconds: 60,
    inputs: [{ name: "source", type: "text", isRequired: true }],
    outputs: [{ name: "result", type: "text" }],
    bindings: {},
    ...changes,
  };
}

/** Builds a valid group node with one member and one parameter port. */
export function groupNode(changes: NodeFields = {}): NodeFields {
  return {
    id: "g1",
    ...POSITION,
    type: "group",
    name: "Group",
    steps: [agentNode({ id: "m1" })],
    parameters: [
      {
        id: "port-1",
        name: "topic",
        type: "text",
        description: "",
        isRequired: false,
        defaultValue: null,
      },
    ],
    bindings: {},
    ...changes,
  };
}

/** Builds a valid loop node with an agent and a script member. */
export function loopNode(changes: NodeFields = {}): NodeFields {
  return {
    id: "l1",
    ...POSITION,
    type: "loop",
    name: "Loop",
    steps: [agentNode({ id: "m2" }), scriptNode({ id: "m3" })],
    edges: [{ from: "m2", to: "m3" }],
    runs: 3,
    runsSource: "value",
    countMode: "max",
    sessionPolicy: "reuse",
    bindings: {},
    condition: null,
    ...changes,
  };
}

/** Builds a valid private plan around the given nodes. */
export function planInput(changes: NodeFields = {}): NodeFields {
  return {
    name: " Plan ",
    workspaceId: "",
    usage: "private",
    globals: {},
    nodes: [
      { id: "start", ...POSITION, type: "start" },
      agentNode(),
      { id: "end", ...POSITION, type: "end" },
    ],
    edges: [
      { from: "start", to: "a1" },
      { from: "a1", to: "end", kind: "flow", fromPort: "out", toPort: "in" },
    ],
    ...changes,
  };
}
