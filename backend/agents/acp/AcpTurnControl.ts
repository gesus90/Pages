import type {
  ContentBlock,
  PromptResponse,
  StopReason,
} from "@agentclientprotocol/sdk";

/** How long an interrupted turn waits for the next input of a person, as the CLIs do. */
const INTERRUPT_WAIT_MS = 5 * 60_000;
/** Follows a person's input that cut a prompt short, so the agent finishes its step after answering. */
const TURN_INPUT_NOTE =
  "(Pages: a person wrote the message above while your step was running. Answer it, then continue the step where you stopped and finish it as instructed, including the report.)";

/** How one turn of a plan session sends its prompts. */
export interface AcpTurnDrive {
  /** The prompt the turn starts with. */
  readonly first: ContentBlock[];
  readonly send: (prompt: ContentBlock[]) => Promise<PromptResponse>;
  /** Runs after every prompt, also a failed one. */
  readonly settled: () => Promise<void>;
  /** The stop of the node, which ends a wait at once. */
  readonly signal: AbortSignal;
  readonly isClosing: () => boolean;
  /** A prompt a person's input cut short ended; the turn goes on. */
  readonly continued: (response: PromptResponse) => Promise<void>;
}

/** What became of an input for the running turn. */
export type AcpTurnInput =
  /** The running prompt has to be cancelled; the input follows as the next prompt of the turn. */
  | "cancel"
  /** The input follows as the next prompt of the turn. */
  | "queued"
  /** No turn runs that could take it. */
  | "inactive";

/**
 * Lets a person intervene in the running turn of a plan session in the same
 * way for every adapter (PAGE-284).
 *
 * @remarks
 * Where the adapter has no steering extension of its own, an input cancels
 * the running `session/prompt` and follows as the next prompt of the same
 * native session; the turn of the node ends only when a prompt ends without
 * waiting input. An interruption cancels the running prompt and waits up to
 * five minutes for the next input; without one, the turn ends as cancelled.
 */
export class AcpTurnControl {
  private readonly cancel: () => Promise<void>;
  private pending: ContentBlock[] = [];
  private prompting = false;
  private isInterrupted = false;
  private wake: (() => void) | null = null;

  /**
   * @param cancel - Cancels the running `session/prompt` of the session.
   */
  public constructor(cancel: () => Promise<void>) {
    this.cancel = cancel;
  }

  /** A `session/prompt` of Pages is running, so a steer can join its turn. */
  public get isPrompting(): boolean {
    return this.prompting;
  }

  /** Whether the turn waits for the input of a person after an interruption. */
  public get isWaiting(): boolean {
    return this.wake !== null;
  }

  /**
   * Takes an input of a person for the running turn.
   *
   * @param prompt - The blocks of the input.
   */
  public add(prompt: readonly ContentBlock[]): "injected" | "inactive" {
    const input = this.queue(prompt);
    if (input === "cancel") void this.cancel();
    return input === "inactive" ? "inactive" : "injected";
  }

  /**
   * Sends the prompts of one turn until a prompt ends without waiting input.
   *
   * @param drive - The first prompt, how to send one and what happens between them.
   * @returns The answer of the last prompt, which ends the turn.
   */
  public async drive(drive: AcpTurnDrive): Promise<PromptResponse> {
    const send = async (prompt: ContentBlock[]): Promise<PromptResponse> => {
      this.prompting = true;
      try {
        return await drive.send(prompt);
      } finally {
        try {
          await drive.settled();
        } finally {
          this.prompting = false;
        }
      }
    };
    let response = await send(drive.first);
    for (
      let next = await this.next(response.stopReason, drive.signal);
      next !== null && !drive.isClosing();
      next = await this.next(response.stopReason, drive.signal)
    ) {
      await drive.continued(response);
      response = await send(next);
    }
    return response;
  }

  /**
   * Interrupts the running prompt for a person; the turn then waits for the next input.
   *
   * @returns Whether a prompt was running.
   */
  public interrupt(): boolean {
    if (!this.prompting) return false;
    this.isInterrupted = true;
    void this.cancel();
    return true;
  }

  /**
   * Cancels the running prompt and continues the turn at once with a note,
   * as when a person cancels the running tool call of a chat (PAGE-303).
   *
   * @returns Whether a prompt was running.
   */
  public cancelWith(note: string): boolean {
    if (!this.interrupt()) return false;
    this.add([{ type: "text", text: note }]);
    return true;
  }

  /**
   * The next prompt of the same turn, after a prompt ended.
   *
   * @param stopReason - How the prompt ended.
   * @param signal - The stop of the node, which ends a wait at once.
   * @returns The waiting input, or `null` when the turn ends here.
   */
  public async next(
    stopReason: StopReason,
    signal: AbortSignal,
  ): Promise<ContentBlock[] | null> {
    const wasInterrupted = this.isInterrupted;
    this.isInterrupted = false;
    if (this.pending.length > 0) return this.take();
    if (!wasInterrupted || stopReason !== "cancelled" || signal.aborted)
      return null;
    await new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        this.wake = null;
        resolve();
      };
      const timer = setTimeout(done, INTERRUPT_WAIT_MS);
      timer.unref();
      this.wake = done;
      signal.addEventListener("abort", done, { once: true });
    });
    return this.pending.length > 0 && !signal.aborted ? this.take() : null;
  }

  private queue(prompt: readonly ContentBlock[]): AcpTurnInput {
    const input: ContentBlock[] = [
      ...prompt,
      { type: "text", text: TURN_INPUT_NOTE },
    ];
    if (this.wake) {
      this.pending.push(...input);
      this.wake();
      return "queued";
    }
    if (!this.prompting) return "inactive";
    // Only the first input cancels; a further one joins it in the next prompt.
    const isFirst = this.pending.length === 0;
    this.pending.push(...input);
    return isFirst ? "cancel" : "queued";
  }

  private take(): ContentBlock[] {
    const next = this.pending;
    this.pending = [];
    return next;
  }
}

/** Progress reaches the run record at most this often. */
export const PROGRESS_INTERVAL_MS = 5_000;
