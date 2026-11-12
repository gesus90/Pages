import type {
  AgentAccessEnvironment,
  AgentActivityEntry,
  AgentEmployee,
  AgentEmployeeListItem,
  AgentMemoryDetails,
} from "./AgentEmployee";
import type { AgentInstructionTemplateList } from "./AgentInstructionTemplate";
import type { PageAgentModel } from "./PageAgent";
import type { AgentVoiceOptions } from "./SpeechSynthesis";

/** The agents tab of the user administration (PAGE-266). */
export interface AgentEmployeePageData {
  readonly agents: readonly AgentEmployeeListItem[];
  /** The models the person may give an agent, with their provider. */
  readonly models: readonly PageAgentModel[];
  readonly canCreate: boolean;
  /** The templates of `AGENT.md` and whether the person may change them (PAGE-283). */
  readonly templates: AgentInstructionTemplateList;
  /** The speech output model of the instance and its voices for the voice tab (PAGE-300). */
  readonly voice: AgentVoiceOptions;
}

/** The panel of one agent as its endpoint answers it. */
export interface AgentEmployeeDetailData {
  readonly agent: AgentEmployee;
  readonly memoryDetails: AgentMemoryDetails;
  readonly activity: readonly AgentActivityEntry[];
  readonly canEdit: boolean;
  /** Whether the person may change the access level: an administrator in active admin mode (PAGE-303). */
  readonly canChangeAccess: boolean;
  /** Isolation and detected MCP servers for the tab "Zugriff". */
  readonly accessEnvironment: AgentAccessEnvironment;
}
