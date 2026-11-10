import type {
  AgentActivityEntry,
  AgentEmployee,
  AgentEmployeeListItem,
  AgentMemoryDetails,
} from "./AgentEmployee";
import type { AgentInstructionTemplateList } from "./AgentInstructionTemplate";
import type { PageAgentModel } from "./PageAgent";

/** The agents tab of the user administration (PAGE-266). */
export interface AgentEmployeePageData {
  readonly agents: readonly AgentEmployeeListItem[];
  /** The models the person may give an agent, with their provider. */
  readonly models: readonly PageAgentModel[];
  readonly canCreate: boolean;
  /** The templates of `AGENT.md` and whether the person may change them (PAGE-283). */
  readonly templates: AgentInstructionTemplateList;
}

/** The panel of one agent as its endpoint answers it. */
export interface AgentEmployeeDetailData {
  readonly agent: AgentEmployee;
  readonly memoryDetails: AgentMemoryDetails;
  readonly activity: readonly AgentActivityEntry[];
  readonly canEdit: boolean;
}
