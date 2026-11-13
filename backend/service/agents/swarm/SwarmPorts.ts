import type { AgentPlanAgentTodo } from "@/definition/AgentPlanAgentTodos";
import type { AgentPlanSwarmRun } from "@/definition/AgentPlanSwarmRun";
import type { SwarmLock } from "./SwarmLocks";
import type { SwarmWorkspaceProbe } from "./SwarmGitProbe";

/** How one turn of a helper or the main model ended. */
export interface SwarmTurn {
  readonly output: string;
  /** `null` for a completed turn. */
  readonly failure: "timeout" | "cancelled" | "failed" | "incomplete" | null;
  readonly errorCode: string | null;
}

/** The open session of one helper; it takes one subtask after the other. */
export interface SwarmWorkerSession {
  /** Runs a further subtask as the next turn of the session. */
  run(prompt: string, signal: AbortSignal): Promise<SwarmTurn>;
  /** Ends the session and its processes; never throws. */
  close(): Promise<void>;
}

/** A helper could not get a session, for instance for lack of ACP capacity. */
export class SwarmStartError extends Error {
  public readonly reason: string;

  /** @param reason - A short code such as `acp_worker_limit` or `cli_not_logged_in`. */
  public constructor(reason: string) {
    super(`Swarm helper not started: ${reason}`);
    this.name = "SwarmStartError";
    this.reason = reason;
  }
}

/** What a helper session reports while it runs. */
export interface SwarmWorkerEvents {
  /** The newest TODO list of the helper. */
  readonly todos: (todos: readonly AgentPlanAgentTodo[]) => void;
}

/** A helper session that just opened, with the turn of its first subtask. */
export interface SwarmOpenedWorker {
  readonly session: SwarmWorkerSession;
  readonly turn: Promise<SwarmTurn>;
}

/** Opens helper sessions; the server adapter goes through the ACP resource scheduler. */
export interface SwarmWorkerLauncher {
  /**
   * Opens the session of a helper with its first subtask.
   *
   * @throws {SwarmStartError} When it gets no session within its deadline.
   */
  open(
    workerId: string,
    first: { readonly prompt: string; readonly signal: AbortSignal },
    events: SwarmWorkerEvents,
  ): Promise<SwarmOpenedWorker>;
}

/** The board of a swarm as it is stored for resuming, with its locks. */
export interface SwarmStoredBoard {
  readonly view: AgentPlanSwarmRun;
  readonly locks: readonly SwarmLock[];
}

/** The boundaries of a swarm coordinator; tests replace each of them. */
export interface SwarmCoordinatorDependencies {
  readonly launcher: SwarmWorkerLauncher;
  readonly probe: SwarmWorkspaceProbe;
  /** Stores the board after every change, in order. */
  readonly save: (board: SwarmStoredBoard) => Promise<void>;
  /** The clock in epoch milliseconds. */
  readonly now: () => number;
  /** How long a lock lives without renewal. */
  readonly leaseMs: number;
}
