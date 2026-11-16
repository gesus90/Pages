import type { ServerCache } from "@/backend/cache/ServerCache";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { StoredUserAvatar } from "@/backend/database/repositories/UserRepository";
import type { StoredAgentUsages } from "@/backend/database/repositories/employee/AgentEmployeeRemovalRepository";
import type { AgentEmployee } from "@/definition/AgentEmployee";
import type {
  AgentEmployeeDetailData,
  AgentEmployeePageData,
} from "@/definition/AgentEmployeePage";
import type { Department, UserRole } from "@/definition/Authorization";

import type { PicaAcpSessionPool } from "../chat/acp/PicaAcpSessionPool";
import type { AgentAccessEnvironmentService } from "./AgentAccessEnvironmentService";
import type { AgentActivityService } from "./AgentActivityService";
import type { AgentEmployeeInput } from "./AgentEmployeeInput";
import type { AgentEmployeeModels } from "./AgentEmployeeModels";
import type { AgentMemoryService } from "./AgentMemoryService";

/** What the administration of agents is built from. */
export interface AgentEmployeeAdministrationDependencies {
  readonly authorization: AuthorizationRepository;
  readonly cache: Pick<
    ServerCache,
    "invalidateUsers" | "invalidateProjectMembership" | "invalidateWorkItems"
  >;
  readonly models: AgentEmployeeModels;
  readonly memory: AgentMemoryService;
  readonly activity: AgentActivityService;
  /** Isolation and MCP servers of the host for the access levels; absent offers no isolation. */
  readonly accessEnvironment?: AgentAccessEnvironmentService;
  /** The resting chat sessions of agents, which a change of the access level ends; absent without ACP chat. */
  readonly sessions?: Pick<PicaAcpSessionPool, "closeForAgent">;
}

/** The agents tab: rows, the model choice and whether the person may create. */
export type AgentEmployeePage = Omit<
  AgentEmployeePageData,
  "templates" | "voice"
>;

/** Everything the panel of one agent shows. */
export type AgentEmployeeDetail = AgentEmployeeDetailData;

/** A new avatar image, already validated. */
export type AgentAvatarUpload = StoredUserAvatar;

/** The roles and departments a person may give an agent. */
export interface AgentEmployeeChoices {
  readonly roles: readonly UserRole[];
  readonly departments: readonly Department[];
}

/** What a removal would take with it, read before the person confirms it. */
export interface AgentEmployeeRemovalScope {
  readonly agent: AgentEmployee;
  readonly usages: StoredAgentUsages;
  /** A running agent cannot be removed or deactivated. */
  readonly isRunning: boolean;
}

/** A save of the agent panel, with the revision it was read at. */
export interface AgentEmployeeUpdate {
  readonly input: AgentEmployeeInput;
  readonly revision: number;
  /** Activates or deactivates the agent in the same change; absent leaves it. */
  readonly isActive?: boolean;
}
