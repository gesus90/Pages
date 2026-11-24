import { noteSessionEvent } from "@/backend/agents/cli/CliSessionEvents";
import { logEvent } from "@/backend/logging/Logger";

import type {
  ContentBlock,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import type { AcpDriver } from "./AcpDriver";

/** The longest command line a continuation note quotes. */
const NOTE_COMMAND_CHARACTERS = 200;

/** Updates that show the agent acted again, so it already read the end of an earlier command. */
const AGENT_ACTIVITY: ReadonlySet<SessionUpdate["sessionUpdate"]> = new Set([
  "agent_message_chunk",
  "agent_thought_chunk",
  "tool_call",
  "plan",
  "usage_update",
]);

/** What the tracker reads of the session it follows. */
interface AcpCommandSession {
  readonly sessionId: string | null;
  /** Requests Pages refused in the running turn. */
  readonly permissionDenials: number;
  /** The session events that record waiting and every end. */
  readonly events: string[];
}

/** A command of the terminal tool that ended after the agent's last activity. */
interface EndedCommand {
  readonly title: string;
  readonly status: "completed" | "failed";
  readonly exitCode: number | null;
}

/**
 * Reads the exit code the adapter reports with the end of a command.
 * @param call - A tool call or its update.
 * @returns The exit code, or `null` when the adapter names none.
 */
export function readAcpExitCode(
  call: ToolCall | ToolCallUpdate,
): number | null {
  const output: unknown = call.rawOutput;
  if (typeof output !== "object" || output === null) return null;
  if (!("exit_code" in output)) return null;
  return typeof output.exit_code === "number" ? output.exit_code : null;
}

function describeEnd(command: EndedCommand): string {
  const title = command.title.slice(0, NOTE_COMMAND_CHARACTERS);
  if (command.exitCode !== null)
    return `- \`${title}\`: ended with exit code ${command.exitCode}`;
  return command.status === "failed"
    ? `- \`${title}\`: ended as failed, without an exit code`
    : `- \`${title}\`: ended, without an exit code`;
}

function continuationNote(ended: readonly EndedCommand[]): ContentBlock[] {
  return [
    {
      type: "text",
      text: [
        "(Pages: your last answer ended while a command of your terminal tool was still running in the background. It has ended now:",
        ...ended.map(describeEnd),
        "Pages counts the step only from now on. Check the result and the exit code, then continue the step where you stopped and finish it as instructed, including the report; a later report replaces an earlier one.)",
      ].join("\n"),
    },
  ];
}

/**
 * Follows the commands an adapter's terminal tool moves into the background.
 * @remarks
 * `agy acp` hands a command that runs longer than the wait the model chose
 * (`WaitMsBeforeAsync`) to the background, and the model may end its prompt
 * with `end_turn` while the command runs on. The adapter reports the end later
 * as a `completed` or `failed` update of the same tool call, with the exit code
 * in `rawOutput.exit_code`. Ending the turn at `end_turn` would judge a step
 * whose command still runs, and closing the session would kill that command.
 * The turn therefore waits until every such command ended and continues the
 * same native session with a note that names each command and its exit code.
 * A command that ended after the agent's last activity counts as well, since
 * the agent has not read its end.
 */
export class AcpBackgroundCommands {
  private readonly running = new Map<string, string>();
  private unseen: EndedCommand[] = [];
  private settled: ((note: ContentBlock[] | null) => void) | null = null;
  private readonly session: AcpCommandSession;

  /**
   * @param session - The state of the session, read when it is needed.
   */
  public constructor(session: AcpCommandSession) {
    this.session = session;
  }

  /**
   * Waits after a prompt ended with `end_turn` until no command of the agent runs on.
   * @param signal - The stop or deadline of the node, which ends the wait.
   * @returns The note that continues the turn, or `null` when no command ran
   * on and none ended unread, or when Pages refused a request of the turn,
   * whose command never ran.
   * @throws The reason of the signal when it aborted while a command ran.
   */
  public readonly settle = async (
    signal: AbortSignal,
  ): Promise<ContentBlock[] | null> => {
    if (this.session.permissionDenials > 0) return null;
    if (this.running.size === 0) return this.takeNote();
    noteSessionEvent(
      this.session.events,
      `turn waits for ${this.running.size} background command(s)`,
    );
    this.log("acp.background_command.waiting", { pending: this.running.size });
    const note = await new Promise<ContentBlock[] | null>((resolve) => {
      const abort = (): void => {
        this.settled = null;
        resolve(null);
      };
      this.settled = (ended) => {
        signal.removeEventListener("abort", abort);
        this.settled = null;
        resolve(ended);
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    signal.throwIfAborted();
    return note;
  };

  /**
   * Reads one update of the session.
   * @param update - The update the adapter sent.
   */
  public receive(update: SessionUpdate): void {
    if (
      update.sessionUpdate === "tool_call" ||
      update.sessionUpdate === "tool_call_update"
    )
      this.readCommand(update);
    if (AGENT_ACTIVITY.has(update.sessionUpdate)) this.unseen = [];
  }

  private readCommand(call: ToolCall | ToolCallUpdate): void {
    const title = this.running.get(call.toolCallId);
    const { status } = call;
    const isEnd = status === "completed" || status === "failed";
    if (title === undefined) {
      if (call.kind === "execute" && !isEnd)
        this.running.set(call.toolCallId, call.title ?? "command");
      return;
    }
    if (status !== "completed" && status !== "failed") return;
    this.running.delete(call.toolCallId);
    const exitCode = readAcpExitCode(call);
    this.unseen.push({ title, status, exitCode });
    if (this.settled === null) return;
    this.log("acp.background_command.ended", {
      status,
      exitCode,
      pending: this.running.size,
    });
    // The note is taken at once, before the agent's own activity on the end reaches the session.
    if (this.running.size === 0) this.settled(this.takeNote());
  }

  private takeNote(): ContentBlock[] | null {
    const ended = this.unseen;
    this.unseen = [];
    if (ended.length === 0) return null;
    noteSessionEvent(
      this.session.events,
      `turn continues after ${ended.length} background command(s) ended`,
    );
    return continuationNote(ended);
  }

  private log(event: string, metadata: Record<string, unknown>): void {
    logEvent({
      level: "info",
      event,
      component: "AcpSession",
      message: "ACP background command",
      metadata: { sessionId: this.session.sessionId, ...metadata },
    });
  }
}

/**
 * The background commands a plan session follows.
 * @param context - The driver of the session and whether it takes a person's input in its turn, as plan sessions do.
 * @param session - The state of the session.
 * @returns The tracker, or `null` for an adapter whose commands never run on
 * after the prompt, and for a chat, whose turn a person ends.
 */
export function acpBackgroundCommands(
  context: {
    readonly driver: Pick<AcpDriver, "runsCommandsInBackground">;
    readonly acceptsTurnInput?: boolean;
  },
  session: AcpCommandSession,
): AcpBackgroundCommands | null {
  return context.driver.runsCommandsInBackground === true &&
    context.acceptsTurnInput === true
    ? new AcpBackgroundCommands(session)
    : null;
}
