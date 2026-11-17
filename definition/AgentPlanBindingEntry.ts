import type { AgentParameterValue } from "./AgentParameters.js";

/**
 * Where a node input takes its value from, as a client reads and writes it.
 * @remarks
 * A file of its own, because the node entries of the operation contract and
 * of the call nodes share it and the MCP package reads it through them. A
 * `port` binding reads a named value output of a flow node: an input an
 * entry accepts (`entry:<name>`), or the run id, reason, payload or a
 * returned value of a calling Jump (`run-id-out`, `reason-out`,
 * `payload-out`, `return:<name>`).
 */
export type AgentPlanBindingEntry =
  | { readonly kind: "literal"; readonly value: AgentParameterValue | null }
  | { readonly kind: "source"; readonly nodeId: string }
  | { readonly kind: "result"; readonly stepId: string }
  | { readonly kind: "previous"; readonly stepId: string }
  | {
      /** One data output of a stack: the entry handed over last, or the number of entries. */
      readonly kind: "stack";
      readonly stackId: string;
      readonly output: "content" | "count";
    }
  | {
      readonly kind: "port";
      readonly nodeId: string;
      readonly port: string;
    };
