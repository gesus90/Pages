import type {
  AgentActivityKind,
  AgentEmployeeAccess,
  AgentInstructionTemplate,
  AgentMemoryVersionReason,
} from "@/definition/AgentEmployee";

/** An object the interface names by identifier and name. */
export interface McpAgentReference {
  readonly id: string;
  readonly name: string;
}

/** The model of an agent: a connection and one of its models. */
export interface McpAgentModel {
  readonly connectionId: string;
  readonly modelId: string;
}

/** An agent without its three documents (interface "Zusammenfassung"). */
export interface McpAgentSummary {
  readonly id: string;
  readonly username: string;
  readonly name: string;
  readonly position: string | null;
  readonly color: string | null;
  readonly imageUrl: string | null;
  readonly model: McpAgentModel;
  readonly reasoning: string | null;
  readonly access: AgentEmployeeAccess;
  readonly costLimitUsdPerMonth: number | null;
  /** Known costs of the month; `null` when only sessions without a reported cost exist. */
  readonly costUsdThisMonth: number | null;
  readonly roleId: string | null;
  readonly departmentIds: readonly string[];
  readonly memoryArchiveWords: number;
  readonly isLearningEnabled: boolean;
  readonly isActive: boolean;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** An agent with `SOUL.md`, `AGENT.md` and `MEMORY.md` (interface "Agent"). */
export interface McpAgentResponse extends McpAgentSummary {
  readonly soul: string;
  readonly agentInstructions: string;
  readonly memory: string;
}

/** A model an agent may get, as the model choice of the interface lists it. */
export interface McpAgentModelOption extends McpAgentModel {
  readonly name: string;
  readonly provider: string;
  readonly connectionName: string | null;
  readonly reasoningEfforts: readonly string[];
  /** The access modes the provider of the model runs. */
  readonly accessModes: readonly AgentEmployeeAccess[];
}

/** A template that fills `AGENT.md`. */
export interface McpAgentTemplate {
  readonly id: AgentInstructionTemplate;
  readonly name: string;
  readonly content: string;
}

/** The choices of `GET /agents/options`. */
export interface McpAgentOptionsResponse {
  readonly models: readonly McpAgentModelOption[];
  readonly roles: readonly McpAgentReference[];
  readonly departments: readonly McpAgentReference[];
  readonly colors: readonly string[];
  readonly accessModes: readonly AgentEmployeeAccess[];
  readonly templates: readonly McpAgentTemplate[];
}

/** A ticket assigned to the agent. */
export interface McpAgentTicketReference {
  readonly id: string;
  readonly key: string;
  readonly title: string;
}

/** What refers to an agent before its removal. */
export interface McpAgentUsagesResponse {
  /** Participant lists of the chat that hold the agent. */
  readonly chatLists: number;
  readonly groups: readonly McpAgentReference[];
  /** All assigned tickets are counted; the first hundred are named. */
  readonly tickets: {
    readonly count: number;
    readonly items: readonly McpAgentTicketReference[];
  };
  readonly projects: readonly McpAgentReference[];
  readonly plans: readonly McpAgentReference[];
}

/** The question before a removal; nothing changed. */
export interface McpAgentRemovalQuestion {
  readonly confirmationRequired: true;
  readonly agent: McpAgentSummary;
  readonly usages: McpAgentUsagesResponse;
  readonly canRemove: boolean;
  readonly blocker: "running" | null;
}

/** A version of `MEMORY.md`. */
export interface McpAgentMemoryVersionResponse {
  readonly id: string;
  readonly createdAt: string;
  readonly source: AgentMemoryVersionReason;
  /** Words of `MEMORY.md` in this version. */
  readonly words: number;
}

/** One entry of the archive. */
export interface McpAgentArchiveEntryResponse {
  readonly id: string;
  readonly createdAt: string;
  readonly text: string;
}

/** One line of the activity. */
export interface McpAgentActivityResponse {
  readonly id: string;
  readonly at: string;
  readonly kind: AgentActivityKind;
  readonly title: string;
  /** Known cost in US dollars; `null` for none or an unknown one. */
  readonly costUsd: number | null;
}

/** One page of a list and where the next one starts. */
export interface McpAgentPage<Item> {
  readonly items: readonly Item[];
  readonly nextCursor: string | null;
}
