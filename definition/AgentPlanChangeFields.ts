/** The fields only a calling Jump has; a receiving Jump ignores them. */
const JUMP_OUT_ONLY_FIELDS = [
  "target",
  "wait",
  "signalName",
  "timeout",
  "workspace",
  "payloadType",
  "returns",
  "bindings",
] as const;

/**
 * The fields of each direction of a Jump node.
 * @remarks
 * `direction` itself is set when the node is created. A receiving entry holds
 * its name, whether other plans may call it and the inputs it accepts; a
 * calling Jump holds the call.
 */
export const PLAN_JUMP_FIELDS = {
  in: ["name", "isEnabled", "inputs"],
  out: ["name", "inputs", ...JUMP_OUT_ONLY_FIELDS],
} as const;

/** Editable node fields shared by the operation reader and MCP schema. Graph membership uses explicit changes. */
export const PLAN_NODE_FIELDS = {
  start: ["name", "callable", "inputs"],
  end: ["returns", "bindings"],
  group: ["name"],
  loop: [
    "name",
    "runs",
    "runsSource",
    "countMode",
    "sessionPolicy",
    "condition",
    "mode",
    "while",
  ],
  agent: [
    "agentId",
    "personalAgentId",
    "instruction",
    "executionTarget",
    "completion",
    "completionGate",
    "role",
    "configuration",
  ],
  script: [
    "name",
    "executionTarget",
    "interpreterProfileId",
    "content",
    "inputs",
    "outputs",
    "timeoutSeconds",
    "disabled",
    "disabledOutput",
    "role",
  ],
  // The removed Git closeout is only moved or removed, never configured.
  git_closeout: [],
  decision: ["name", "mode", "question", "model", "output", "cases", "input"],
  stack: ["name", "entries"],
  swarm: [
    "name",
    "task",
    "main",
    "workers",
    "directory",
    "timeoutMinutes",
    "executionTarget",
    "memory",
  ],
  asset: ["name", "file"],
  jump: ["direction", "name", "isEnabled", "inputs", ...JUMP_OUT_ONLY_FIELDS],
  signal: ["name", "signalName", "payloadType", "bindings"],
  task: ["taskId"],
  parameter: ["name", "format", "value"],
  variable: [],
} as const;

/** Node families the editor creates; legacy variables remain readable and movable. */
export const PLAN_ADDABLE_TYPES = [
  "start",
  "end",
  "agent",
  "script",
  "task",
  "parameter",
  "group",
  "loop",
  "stack",
  "decision",
  "swarm",
  "jump",
  "signal",
] as const;
