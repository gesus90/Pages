import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { requireSessionAttempt } from "@/backend/service/agents/sessions/AgentSessionAttempts";
import {
  TERMINAL_OPEN_CHARACTERS,
  TERMINAL_PAGE_CHARACTERS,
} from "@/definition/AgentTerminal";

import type { AgentSessionRunAccess } from "@/backend/service/agents/sessions/AgentSessionService";
import type {
  AgentTerminalRecord,
  TerminalViewStore,
} from "@/backend/agents/terminal/TerminalStore";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentSessionKey } from "@/definition/AgentSessionJournal";
import type {
  AgentTerminalCommand,
  AgentTerminalEvent,
  AgentTerminalInput,
  AgentTerminalOpening,
  AgentTerminalPage,
  AgentTerminalState,
} from "@/definition/AgentTerminal";
import type { TerminalSignalSource } from "./TerminalSignals";

/** Whether a person may change what runs: the right to run the plan. */
export interface AgentTerminalPlanAccess {
  require(
    userId: string,
    planId: string,
  ): Promise<{ readonly canEdit: boolean }>;
}

/** What the terminal service works with. */
export interface AgentTerminalServiceDependencies {
  readonly runs: AgentSessionRunAccess;
  readonly plans: AgentTerminalPlanAccess;
  readonly store: TerminalViewStore;
  readonly signals: TerminalSignalSource;
  readonly clock?: () => string;
}

/** Where the checked inputs of one person go. */
export interface AgentTerminalInputTarget {
  readonly userId: string;
  readonly runId: string;
  readonly instanceId: string;
}

/** A terminal a person may read, with the run it belongs to. */
interface AuthorizedTerminal {
  readonly run: AgentPlanRun;
  readonly terminal: AgentTerminalRecord;
  readonly canInput: boolean;
}

function isRunActive(run: AgentPlanRun): boolean {
  return ["running", "pausing", "paused", "stopping"].includes(run.status);
}

/** The input a command stores for the process of the terminal. */
function inputOf(command: AgentTerminalCommand): AgentTerminalInput {
  if (command.type === "input") return { kind: "data", text: command.data };
  if (command.type === "paste") return { kind: "paste", text: command.text };
  if (command.type === "interrupt") return { kind: "interrupt" };
  return { kind: "resize", columns: command.columns, rows: command.rows };
}

/**
 * The terminal of a plan node for its viewers (PAGE-265).
 *
 * @remarks
 * Reading follows the rights of the session history: only who may read the
 * run reads its terminal. Typing needs more: the right to run the plan, a
 * run that still runs and a CLI that still runs. Every input is checked on
 * its own before it is queued for the process of the terminal; the browser
 * decides nothing. Following reads the stored segments only; it starts no
 * process and holds no capacity.
 */
export class AgentTerminalService {
  private readonly dependencies: AgentTerminalServiceDependencies;
  private readonly clock: () => string;

  public constructor(dependencies: AgentTerminalServiceDependencies) {
    this.dependencies = dependencies;
    this.clock = dependencies.clock ?? (() => new Date().toISOString());
  }

  /**
   * What a viewer gets when it opens the terminal: the current screen of a
   * full-screen CLI or the last share of an ordinary one, with its state.
   *
   * @throws {AgentError} `plan_access_denied` without read access,
   * `plan_terminal_unavailable` for a node without a terminal.
   */
  public async open(
    userId: string,
    key: AgentSessionKey,
  ): Promise<AgentTerminalOpening> {
    const { terminal, canInput } = await this.authorize(userId, key);
    const { store } = this.dependencies;
    const hasScreen = terminal.isAlternateScreen && terminal.screen !== null;
    const segments = hasScreen
      ? await store.after(
          terminal.instanceId,
          terminal.screenSequence,
          Number.MAX_SAFE_INTEGER,
        )
      : await store.latest(terminal.instanceId, 0, TERMINAL_OPEN_CHARACTERS);
    const first = segments[0]?.sequence ?? terminal.nextSequence;
    return {
      state: stateOf(terminal, canInput),
      screen: hasScreen ? terminal.screen : null,
      screenSequence: hasScreen ? terminal.screenSequence : 0,
      segments,
      hasOlder: !hasScreen && first > terminal.retainedFrom,
    };
  }

  /**
   * One page of older segments of an ordinary CLI, while the viewer scrolls up.
   *
   * @param userId - The reader.
   * @param key - The node attempt.
   * @param before - The first segment the viewer has.
   */
  public async older(
    userId: string,
    key: AgentSessionKey,
    before: number,
  ): Promise<AgentTerminalPage> {
    const { terminal } = await this.authorize(userId, key);
    const segments = await this.dependencies.store.before(
      terminal.instanceId,
      before,
      TERMINAL_PAGE_CHARACTERS,
    );
    const first = segments[0]?.sequence ?? before;
    return { segments, hasOlder: first > terminal.retainedFrom };
  }

  /**
   * Follows the terminal from a cursor: every later segment once, in order,
   * and its state whenever it changes.
   *
   * @returns Ends the following.
   */
  public async follow(
    userId: string,
    key: AgentSessionKey,
    after: number,
    listener: (event: AgentTerminalEvent) => void,
  ): Promise<() => void> {
    const authorized = await this.authorize(userId, key);
    const follower = new TerminalFollower({
      store: this.dependencies.store,
      authorized,
      after,
      listener,
      refresh: () => this.authorize(userId, key),
    });
    const stop = this.dependencies.signals.subscribe(
      "output",
      authorized.terminal.instanceId,
      () => follower.poll(),
    );
    follower.poll();
    return stop;
  }

  /**
   * Checks one input of a viewer and queues it for the CLI.
   *
   * @throws {AgentError} `plan_access_denied` without the right to run the
   * plan, `plan_terminal_unavailable` when the run or the CLI has ended.
   */
  public async send(
    userId: string,
    key: AgentSessionKey,
    command: AgentTerminalCommand,
  ): Promise<void> {
    await this.deliver(await this.inputTarget(userId, key), command);
  }

  /**
   * Checks that a person may type into a terminal now.
   *
   * @returns Where the inputs of this person go.
   * @throws {AgentError} `plan_access_denied` without the right to run the
   * plan, `plan_terminal_unavailable` when the run or the CLI has ended.
   */
  public async inputTarget(
    userId: string,
    key: AgentSessionKey,
  ): Promise<AgentTerminalInputTarget> {
    const { run, terminal, canInput } = await this.authorize(userId, key);
    if (!canInput) {
      throw new AgentError(
        terminal.state === "running" && isRunActive(run)
          ? "plan_access_denied"
          : "plan_terminal_unavailable",
      );
    }
    return { userId, runId: run.id, instanceId: terminal.instanceId };
  }

  /**
   * Queues an input for a target checked with {@link inputTarget}; any input
   * except a resize marks the run as one somebody intervened in.
   */
  public async deliver(
    target: AgentTerminalInputTarget,
    command: AgentTerminalCommand,
  ): Promise<void> {
    const { store } = this.dependencies;
    await store.enqueue(target.instanceId, target.userId, inputOf(command));
    if (command.type !== "resize")
      await store.markManualInput(target.runId, this.clock());
  }

  /**
   * Whether a person may type into the terminal of a node now.
   *
   * @returns `false` without the right to run the plan or after the CLI ended.
   */
  public async canInput(
    userId: string,
    key: AgentSessionKey,
  ): Promise<boolean> {
    return (await this.authorize(userId, key)).canInput;
  }

  private async authorize(
    userId: string,
    key: AgentSessionKey,
  ): Promise<AuthorizedTerminal> {
    const run = await this.dependencies.runs.run(userId, key.runId);
    const attempt = requireSessionAttempt(run, key);
    const terminal = await this.dependencies.store.find(
      attempt.record.instanceId,
    );
    if (!terminal || terminal.runId !== run.id)
      throw new AgentError("plan_terminal_unavailable");
    const isRunning = terminal.state === "running" && isRunActive(run);
    const canInput =
      isRunning &&
      (await this.dependencies.plans.require(userId, run.planId)).canEdit;
    return { run, terminal, canInput };
  }
}

function stateOf(
  terminal: AgentTerminalRecord,
  canInput: boolean,
): AgentTerminalState {
  return {
    status: terminal.state,
    columns: terminal.columns,
    rows: terminal.rows,
    isAlternateScreen: terminal.isAlternateScreen,
    canInput,
    activeStepId: terminal.activeStepId,
    question: terminal.question,
    lastActivityAt: terminal.updatedAt,
    endedAt: terminal.endedAt,
  };
}

/** A changed last activity alone is reported at most this often. */
const ACTIVITY_INTERVAL_MS = 5_000;

/** Rights are checked again at most this often while a viewer follows. */
const RIGHTS_INTERVAL_MS = 15_000;

/** One viewer that follows a terminal from its cursor. */
class TerminalFollower {
  private readonly store: TerminalViewStore;
  private readonly listener: (event: AgentTerminalEvent) => void;
  private readonly refresh: () => Promise<AuthorizedTerminal>;
  private readonly instanceId: string;
  private authorized: AuthorizedTerminal;
  private cursor: number;
  private lastState = "";
  private stateAt = 0;
  private checkedAt = Date.now();
  private reading: Promise<void> = Promise.resolve();
  private isPending = false;

  public constructor(input: {
    readonly store: TerminalViewStore;
    readonly authorized: AuthorizedTerminal;
    readonly after: number;
    readonly listener: (event: AgentTerminalEvent) => void;
    readonly refresh: () => Promise<AuthorizedTerminal>;
  }) {
    this.store = input.store;
    this.authorized = input.authorized;
    this.instanceId = input.authorized.terminal.instanceId;
    this.cursor = input.after;
    this.listener = input.listener;
    this.refresh = input.refresh;
  }

  /** Reads what is new; calls that arrive while it reads are merged into one more read. */
  public poll(): void {
    if (this.isPending) return;
    this.isPending = true;
    this.reading = this.reading.then(async () => {
      this.isPending = false;
      try {
        await this.read();
      } catch (error: unknown) {
        logCaughtError("AgentTerminalService", error);
      }
    });
  }

  private async read(): Promise<void> {
    if (Date.now() - this.checkedAt > RIGHTS_INTERVAL_MS) {
      this.authorized = await this.refresh();
      this.checkedAt = Date.now();
    }
    const terminal = await this.store.find(this.instanceId);
    if (!terminal) return;
    if (this.cursor > 0 && this.cursor + 1 < terminal.retainedFrom) {
      this.listener({ kind: "gap", sequence: terminal.retainedFrom - 1 });
      this.cursor = terminal.retainedFrom - 1;
    }
    for (;;) {
      const segments = await this.store.after(
        this.instanceId,
        this.cursor,
        TERMINAL_PAGE_CHARACTERS,
      );
      for (const segment of segments) {
        this.cursor = segment.sequence;
        this.listener({
          kind: "output",
          sequence: segment.sequence,
          chunk: segment.chunk,
        });
      }
      if (segments.length === 0 || this.cursor >= terminal.nextSequence - 1)
        break;
    }
    const canInput = this.authorized.canInput && terminal.state === "running";
    const state = stateOf(terminal, canInput);
    // The last activity changes with every segment; alone it is sent at most every few seconds.
    const serialized = JSON.stringify({ ...state, lastActivityAt: null });
    const isActivityDue = Date.now() - this.stateAt > ACTIVITY_INTERVAL_MS;
    if (serialized === this.lastState && !isActivityDue) return;
    this.lastState = serialized;
    this.stateAt = Date.now();
    this.listener({ kind: "state", state });
  }
}
