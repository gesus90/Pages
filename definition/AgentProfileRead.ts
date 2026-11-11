/**
 * Contracts of the readable agent profiles (PAGE-308).
 *
 * @remarks
 * Administrators, group leaders and project managers read what an agent does:
 * role, documents, model and workload. Never part of a profile: `MEMORY.md`,
 * `DREAM.md`, the memory archive, chat contents and credentials.
 */

/** An object named by identifier and name. */
export interface AgentProfileReference {
  readonly id: string;
  readonly name: string;
}

/** A project of an agent with its project role. */
export interface AgentProfileProject extends AgentProfileReference {
  readonly role: string;
}

/** The model of an agent and the connection it runs on. */
export interface AgentProfileModel {
  readonly connectionId: string;
  readonly provider: string | null;
  readonly model: string;
  readonly reasoningEffort: string | null;
}

/** The voice of an agent, once an agent has one (PAGE-300). */
export interface AgentProfileVoice {
  readonly voiceId: string;
  readonly speed: number;
}

/** A ticket assigned to an agent that is not finished. */
export interface AgentProfileTicket {
  readonly id: string;
  readonly key: string;
  readonly title: string;
}

/** A plan step an agent works on right now. */
export interface AgentProfileRunningStep {
  readonly planId: string;
  readonly runId: string;
  readonly stepId: string;
}

/** The workload of an agent in full. */
export interface AgentProfileLoad {
  readonly activeChats: number;
  readonly runningSteps: readonly AgentProfileRunningStep[];
  readonly openTickets: readonly AgentProfileTicket[];
}

/** One agent of a list. */
export interface AgentProfileListItem {
  readonly id: string;
  readonly displayName: string;
  readonly isAgent: boolean;
  readonly role: string | null;
  /** The first lines of `AGENT.md`. */
  readonly summary: string | null;
  readonly departments: readonly AgentProfileReference[];
  readonly groups: readonly AgentProfileReference[];
  readonly model: AgentProfileModel | null;
  readonly activeChats: number;
  readonly runningSteps: number;
  readonly openTickets: number;
  /** The fields the reader may not see. */
  readonly hiddenFields: readonly string[];
}

/** One page of the agents a person may read. */
export interface AgentProfileList {
  readonly agents: readonly AgentProfileListItem[];
  readonly total: number;
  readonly nextCursor: string | null;
}

/** One agent with every field the reader may see. */
export interface AgentProfileDetail {
  readonly id: string;
  readonly displayName: string;
  readonly isAgent: boolean;
  readonly role: string | null;
  readonly agentMd: string | null;
  readonly soulMd: string | null;
  readonly departments: readonly AgentProfileReference[];
  readonly groups: readonly AgentProfileReference[];
  readonly projects: readonly AgentProfileProject[];
  readonly model: AgentProfileModel | null;
  readonly accessLevel: string | null;
  readonly voice: AgentProfileVoice | null;
  readonly load: AgentProfileLoad;
  readonly lastActiveAt: string | null;
  readonly hiddenFields: readonly string[];
}

/** A person or agent in a group. */
export interface AgentProfileGroupMember {
  readonly id: string;
  readonly displayName: string;
  readonly isAgent: boolean;
}

/** A group with its leaders and members. */
export interface AgentProfileGroup {
  readonly id: string;
  readonly name: string;
  readonly leaders: readonly Pick<
    AgentProfileGroupMember,
    "id" | "displayName"
  >[];
  readonly members: readonly AgentProfileGroupMember[];
}

/** The filters and the page of a list. */
export interface AgentProfileQuery {
  readonly groupId?: string;
  readonly departmentId?: string;
  readonly projectId?: string;
  /** Position of the next page, as a previous answer returned it. */
  readonly cursor?: string;
  /** 1 to 100; absent means 20. */
  readonly limit?: number;
}

/** Lowest and highest page size of a list, and the default. */
export const AGENT_PROFILE_LIMITS = {
  defaultLimit: 20,
  maximumLimit: 100,
} as const;

/** Fields no leader reads: the memory of another agent and what chats contain. */
export const AGENT_PROFILE_LEADER_HIDDEN_FIELDS = [
  "memory",
  "dream",
  "memoryArchive",
  "chatContents",
  "credentials",
] as const;

/** Fields nobody reads, not even an administrator. */
export const AGENT_PROFILE_ALWAYS_HIDDEN_FIELDS = ["credentials"] as const;
