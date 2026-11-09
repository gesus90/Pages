import type {
  AgentTerminalInput,
  AgentTerminalProvider,
  AgentTerminalSegment,
} from "@/definition/AgentTerminal";

/** The PostgreSQL channel that tells the processes of an instance about terminal changes. */
export const TERMINAL_CHANNEL = "pages_terminal";

/** What a notification on {@link TERMINAL_CHANNEL} announces. */
export type TerminalNotice = "output" | "input";

/** The stored terminal of one CLI process. */
export interface AgentTerminalRecord {
  readonly instanceId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly provider: AgentTerminalProvider;
  readonly state: "running" | "ended";
  readonly columns: number;
  readonly rows: number;
  readonly isAlternateScreen: boolean;
  readonly screen: string | null;
  readonly screenSequence: number;
  /** Sequence of the next segment; the last stored one is one less. */
  readonly nextSequence: number;
  /** The first segment still stored. */
  readonly retainedFrom: number;
  readonly activeStepId: string | null;
  readonly question: string | null;
  readonly startedAt: string;
  /** When the terminal changed last, such as its newest segment. */
  readonly updatedAt: string;
  readonly endedAt: string | null;
}

/** A new terminal before its process starts. */
export interface NewAgentTerminal {
  readonly instanceId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly provider: AgentTerminalProvider;
  readonly columns: number;
  readonly rows: number;
  readonly startedAt: string;
}

/** The screen of a terminal up to a segment. */
export interface AgentTerminalScreenState {
  readonly screen: string;
  readonly sequence: number;
  readonly isAlternateScreen: boolean;
  readonly columns: number;
  readonly rows: number;
}

/** What the process that runs a terminal writes and reads. */
export interface TerminalHostStore {
  open(terminal: NewAgentTerminal): Promise<void>;
  /**
   * Appends one redacted segment and announces it.
   *
   * @returns Its sequence, or `null` for a terminal that has ended.
   */
  append(instanceId: string, body: string): Promise<number | null>;
  /** Removes the oldest segments beyond the limit of one session. */
  retain(instanceId: string, limit: number): Promise<void>;
  saveScreen(
    instanceId: string,
    screen: AgentTerminalScreenState,
  ): Promise<void>;
  /** Marks the node whose turn runs now. */
  activate(instanceId: string, stepId: string): Promise<void>;
  /** Records an open question of the CLI that failed its node. */
  question(instanceId: string, question: string): Promise<void>;
  end(instanceId: string, endedAt: string): Promise<void>;
  /** Takes the waiting inputs in the order they were sent; each is applied once. */
  takeInputs(instanceId: string): Promise<readonly AgentTerminalInput[]>;
}

/** What the web side reads and writes. */
export interface TerminalViewStore {
  find(instanceId: string): Promise<AgentTerminalRecord | null>;
  /** Segments after a sequence, oldest first, up to about `characters`. */
  after(
    instanceId: string,
    after: number,
    characters: number,
  ): Promise<readonly AgentTerminalSegment[]>;
  /** The newest segments after a sequence whose sizes add up to about `characters`, oldest first. */
  latest(
    instanceId: string,
    after: number,
    characters: number,
  ): Promise<readonly AgentTerminalSegment[]>;
  /** The newest segments before a sequence whose sizes add up to about `characters`, oldest first. */
  before(
    instanceId: string,
    before: number,
    characters: number,
  ): Promise<readonly AgentTerminalSegment[]>;
  /** Queues an input for the process of the terminal and announces it. */
  enqueue(
    instanceId: string,
    userId: string,
    input: AgentTerminalInput,
  ): Promise<void>;
  /** Marks the run as one somebody intervened in; the first time stays. */
  markManualInput(runId: string, at: string): Promise<void>;
  /** Deletes the terminal logs of a run. */
  removeRun(runId: string): Promise<void>;
}
