import type { CliProviderId } from "./AgentConnection";
import type { AgentRunOptions } from "./AgentConfiguration";

/** The runner of a node: a CLI tool, or a request to an API connection. */
export type AgentPlanRunner = CliProviderId | "api";

/**
 * How a node talks to its runner.
 *
 * @remarks
 * A one-shot call ends its process with the turn. An interactive session
 * stays open after the turn until Pages closes it. A request has no process.
 */
export type AgentPlanSessionMode = "one_shot" | "interactive" | "request";

/**
 * What decides that a node finished its work.
 *
 * @remarks
 * `report` is the closing report with its todos and acceptance criteria,
 * checked as a gate. `todos` follows only the current todo list of the bound
 * tickets, which the agent ticks live; the result is shown but never gates
 * the run.
 */
export type AgentPlanCompletion = "report" | "todos";

/** What Pages asks a runner for; never a secret. */
export interface AgentPlanRunnerConfiguration {
  readonly runner: AgentPlanRunner;
  readonly connectionId: string;
  readonly connectionName: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
  /** Run options of the agent; absent for API requests, which use no tools. */
  readonly options: AgentRunOptions | null;
  /** How the runner works without asking anyone, as passed to it. */
  readonly unattended: string;
  /** Whether the session reaches Pages through the local MCP process. */
  readonly mcp: boolean;
  readonly directory: string | null;
}

/** One entry of the todo list or the acceptance criteria of a node. */
export interface AgentPlanContractItem {
  /** Short name the report refers to, such as `T1` or `K2`. */
  readonly id: string;
  readonly text: string;
  /** The checklist entry of a bound ticket, which the agent sets through MCP. */
  readonly ticket: {
    readonly id: string;
    readonly key: string;
    readonly itemId: string;
  } | null;
}

/**
 * What a node must finish, fixed and stored before it starts.
 *
 * @remarks
 * With the `todos` completion the contract lists only the todos of the
 * bound tickets and has no criteria; it is replaced by the current list when
 * the node ends, so the record shows the list the agent worked from last.
 */
export interface AgentPlanContract {
  /** Absent in records of nodes that completed by report. */
  readonly completion?: AgentPlanCompletion;
  readonly todos: readonly AgentPlanContractItem[];
  readonly criteria: readonly AgentPlanContractItem[];
  /** Tickets and their requirements at the start; the hash is absent in older run records. */
  readonly tickets: readonly {
    readonly id: string;
    readonly key: string;
    readonly requirementsHash?: string;
  }[];
}

/** The state the closing report gave one todo. */
export interface AgentPlanTodoStatus {
  readonly id: string;
  readonly status: "done" | "open" | "missing";
}

/** The evidence the closing report gave one criterion, and the ticket state. */
export interface AgentPlanCriterionStatus {
  readonly id: string;
  readonly met: boolean;
  readonly evidence: string;
  /** The checkbox in the ticket after the turn; `null` without a ticket entry. */
  readonly ticketChecked: boolean | null;
}

/**
 * The business acceptance of a node, separate from the process exit.
 *
 * @remarks
 * `open` exists only for the `todos` completion: todos remain open, which is
 * shown but does not fail the node.
 */
export interface AgentPlanAcceptance {
  readonly verdict: "accepted" | "open" | "rejected";
  readonly todos: readonly AgentPlanTodoStatus[];
  readonly criteria: readonly AgentPlanCriterionStatus[];
  /** Decisions the agent took on its own instead of asking. */
  readonly decisions: readonly string[];
  /** Why the node was not accepted, as stable codes. */
  readonly issues: readonly string[];
  readonly summary: string;
}

/** How the process of a session ended. */
export interface AgentPlanProcessExit {
  readonly code: number | null;
  readonly signal: string | null;
}

/**
 * The observable record of one node: runner, session, process, acceptance and result.
 *
 * @remarks
 * `resultCode` is the normalized outcome of Pages: 0 only after an accepted
 * report and a confirmed closeout, -1 otherwise. The real process exit is kept
 * apart in `exit`.
 */
export interface AgentPlanSessionRecord {
  readonly runner: AgentPlanRunner;
  readonly mode: AgentPlanSessionMode;
  /** Pages' identifier of this process instance; it tags every process of the session. */
  readonly instanceId: string;
  /** The runner's own session or thread identifier, once it reported one. */
  readonly sessionId: string | null;
  readonly processId: number | null;
  readonly startedAt: string | null;
  readonly turnEndedAt: string | null;
  readonly endedAt: string | null;
  readonly exit: AgentPlanProcessExit | null;
  readonly closeout: "pending" | "confirmed" | "failed" | "not_needed";
  /** Processes of the session found and ended after it closed. */
  readonly leftoverProcesses: number | null;
  readonly resultCode: 0 | -1 | null;
  readonly requested: AgentPlanRunnerConfiguration;
  /** What the runner reported about itself, such as its model and permission mode. */
  readonly effective: Readonly<Record<string, string>> | null;
  readonly definition: {
    readonly path: string;
    readonly revision: number;
  } | null;
  readonly contract: AgentPlanContract | null;
  readonly acceptance: AgentPlanAcceptance | null;
  /** Short, redacted lines of what happened in the session. */
  readonly events: readonly string[];
}
