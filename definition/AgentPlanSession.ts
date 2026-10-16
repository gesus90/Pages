import type { CliProviderId } from "./AgentConnection";
import type { AcpProviderId, AgentRunOptions } from "./AgentConfiguration";

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
 * The scope of the progress report, independent of execution completion.
 *
 * @remarks
 * `report` describes todos and acceptance criteria. `todos` follows only the
 * current todo list of the bound tickets, which the agent ticks live. Both
 * are diagnostic for standalone agents. Internal group steps additionally
 * require an accepted report before releasing their successor.
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
 * The work a node reports on, stored before it starts and reconciled afterwards.
 *
 * @remarks
 * The current ticket lists replace the starting requirements after the turn,
 * preserving report IDs only for unchanged entries. The `todos` report scope
 * has no criteria. The pinned prompt keeps the original assignment.
 */
export interface AgentPlanContract {
  /** Absent in records of nodes that completed by report. */
  readonly completion?: AgentPlanCompletion;
  readonly todos: readonly AgentPlanContractItem[];
  readonly criteria: readonly AgentPlanContractItem[];
  /** Tickets and the requirements shown in this contract; the hash is absent in older records. */
  readonly tickets: readonly {
    readonly id: string;
    readonly key: string;
    readonly requirementsHash?: string;
  }[];
}

/** Current ticket checkbox state, or reported progress for a todo without a ticket entry. */
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
 * Diagnostic business progress, separate from the execution result.
 *
 * @remarks
 * `accepted` means no progress issues were found; `open` preserves incomplete
 * or unknown work and report issues. `rejected` remains readable in historical
 * records. Standalone agents use these values as diagnostics; internal group
 * steps require `accepted` as well as successful runner completion.
 */
export interface AgentPlanAcceptance {
  readonly verdict: "accepted" | "open" | "rejected";
  readonly todos: readonly AgentPlanTodoStatus[];
  readonly criteria: readonly AgentPlanCriterionStatus[];
  /** Decisions the agent took on its own instead of asking. */
  readonly decisions: readonly string[];
  /** Stable progress and report issue codes used by the group's acceptance gate. */
  readonly issues: readonly string[];
  readonly summary: string;
}

/** How the process of a session ended. */
export interface AgentPlanProcessExit {
  readonly code: number | null;
  readonly signal: string | null;
}

/**
 * How a member of an ACP group took part in the group's shared session of one run.
 *
 * @remarks
 * Three identifiers stay apart: the ACP session ID the adapter issued, which
 * only the adapter process that issued it can continue; the adapter's own
 * native session ID, which Pages records only when an adapter reports it apart
 * from the ACP ID; and the Pages run and node IDs. The session's lifetime is
 * the process of the creating node: its start, end and closeout.
 */
export interface AgentPlanGroupSessionLink {
  readonly groupId: string;
  /** The technical adapter ID of the group's ACP class. */
  readonly adapter: AcpProviderId;
  /** Whether this node opened the shared session or continued it. */
  readonly role: "created" | "continued";
  /** The Pages node whose turn opened the session in this run. */
  readonly creatorStepId: string;
  /** The place of this node's turn in the shared session, from 1. */
  readonly turn: number;
  /** The ACP session ID; `null` until the adapter issued it. */
  readonly acpSessionId: string | null;
  /** The adapter's own session ID apart from the ACP one; no adapter Pages runs reports one. */
  readonly nativeSessionId: string | null;
}

/**
 * The observable record of one node: runner, session, process, acceptance and result.
 *
 * @remarks
 * `resultCode` is the normalized execution outcome: 0 for a regular runner
 * completion and clean, confirmed closeout, -1 for a technical failure or
 * cancellation or failed group acceptance. Standalone progress remains diagnostic. The actual process
 * exit is kept in `exit`; retained group turns await the shared closeout.
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
  /** The shared session of the node's ACP group; absent outside groups and in older records. */
  readonly group?: AgentPlanGroupSessionLink;
}
