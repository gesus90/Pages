import { redactCredentials } from "@/backend/security/AgentTextSafety";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import type { ChatJobRepository } from "@/backend/database/repositories/chat/ChatJobRepository";
import type { ChatJobEvent, ChatJobTextEvent } from "@/definition/ChatJob";

/** Answer text reaches the journal at most this often, so a stream does not write per token. */
const TEXT_FLUSH_MS = 400;

/**
 * The append-only journal of one Pica job.
 *
 * @remarks
 * Entries are written one after another and numbered only after they were
 * stored, so the numbers of a job stay contiguous even when a write fails.
 * Text of the running answer is collected briefly and written as one entry.
 * Nothing of it reaches a log.
 */
export class PicaAcpJournal {
  private readonly repository: Pick<ChatJobRepository, "append">;
  private readonly jobId: string;
  private readonly writes = new SerialQueue();
  private sequence = 0;
  private pendingText: {
    turn: number;
    isReset: boolean;
    delta: string;
  } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  public constructor(
    repository: Pick<ChatJobRepository, "append">,
    jobId: string,
  ) {
    this.repository = repository;
    this.jobId = jobId;
  }

  /** Stores an entry after complete words; turn and end markers finalize retained text. */
  public record(event: ChatJobEvent): Promise<void> {
    this.flushText(event.kind === "end" || event.kind === "turn");
    return this.enqueue(event);
  }

  /** Stores an entry nobody waits for, such as a tool call or a compaction; a failed write is logged. */
  public note(event: ChatJobEvent): void {
    void this.record(event).catch((caughtError: unknown) => {
      logCaughtError("PicaAcpJob", caughtError);
      return undefined;
    });
  }

  /** Collects answer text of a turn; a reset or another turn writes what came before. */
  public text(turn: number, isReset: boolean, delta: string): void {
    const pending = this.pendingText;
    if (pending !== null && (isReset || pending.turn !== turn))
      this.flushText(true);
    this.pendingText ??= { turn, isReset, delta: "" };
    this.pendingText.delta += delta;
    this.timer ??= setTimeout(() => this.flushText(), TEXT_FLUSH_MS);
    this.timer.unref();
  }

  /** Finalizes retained text and resolves once every submitted entry is stored or failed. */
  public async drain(): Promise<void> {
    this.flushText(true);
    await this.writes.idle();
  }

  private flushText(shouldFinish = false): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const pending = this.pendingText;
    if (pending === null) return;
    // Keep an unfinished word so a credential split across updates reaches
    // the filter intact, even when a timer or another event flushes the text.
    const length = shouldFinish
      ? pending.delta.length
      : (/\S*$/u.exec(pending.delta)?.index ?? 0);
    if (length === 0 && !shouldFinish) return;
    const remainder = pending.delta.slice(length);
    this.pendingText = remainder
      ? { ...pending, isReset: false, delta: remainder }
      : null;
    const event: ChatJobTextEvent = {
      kind: "text",
      ...pending,
      delta: redactCredentials(pending.delta.slice(0, length)),
    };
    void this.enqueue(event).catch((caughtError: unknown) => {
      logCaughtError("PicaAcpJournal", caughtError);

      // The reason was logged by enqueue; the next entry keeps the numbering.
    });
  }

  private enqueue(event: ChatJobEvent): Promise<void> {
    return this.writes.run(async () => {
      const sequence = this.sequence + 1;
      try {
        await this.repository.append(this.jobId, sequence, event);
      } catch (error: unknown) {
        logCaughtError("PicaAcpJournal", error);

        // Only the kind of the entry is logged, never its text.
        logDiagnostic(
          "PicaAcpJournal",
          "error",
          "[pages] A Pica job entry could not be stored.",
          error,
        );
        throw error;
      }
      this.sequence = sequence;
    });
  }
}
