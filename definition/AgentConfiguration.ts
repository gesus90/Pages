import type {
  AgentProfileTarget,
  AgentProfileTargetKind,
} from "./AgentProfile";
import type { AgentParameter } from "./AgentParameters";

/** Optional task configuration belongs to the same agent as its model access. */
export interface AgentConfiguration {
  readonly scope: AgentProfileTargetKind;
  readonly tag: string;
  readonly markdown: string;
  readonly projectId: string | null;
  readonly accessMode: "personal" | "shared";
  readonly parameters: readonly AgentParameter[];
  /** A prompt path has no runner side effect; this explicitly names its future directory binding. */
  readonly directoryParameter: string | null;
  /** Usage grants do not grant access to a connection or a project. */
  readonly sharing: {
    readonly isGlobal: boolean;
    readonly targets: readonly AgentProfileTarget[];
  };
}

/** Creates an empty task section without granting usage or assigning a system function. */
export function emptyAgentConfiguration(
  scope: AgentProfileTargetKind = "person",
): AgentConfiguration {
  return {
    scope,
    tag: "",
    markdown: "",
    projectId: null,
    accessMode: scope === "person" ? "personal" : "shared",
    parameters: [],
    directoryParameter: null,
    sharing: { isGlobal: false, targets: [] },
  };
}
