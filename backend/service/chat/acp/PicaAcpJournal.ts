import { SerialQueue } from "@/backend/concurrency/SerialQueue";

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

  /** Stores one entry after the text collected so far. */
  public record(event: ChatJobEvent): Promise<void> {
    this.flushText();
    return this.enqueue(event);
  }

  /** Collects answer text of a turn; a reset or another turn writes what came before. */
  public text(turn: number, isReset: boolean, delta: string): void {
    const pending = this.pendingText;
    if (pending !== null && (isReset || pending.turn !== turn))
      this.flushText();
    this.pendingText ??= { turn, isReset, delta: "" };
    this.pendingText.delta += delta;
    this.timer ??= setTimeout(() => this.flushText(), TEXT_FLUSH_MS);
    this.timer.unref();
  }

  /** Resolves once every entry submitted so far is stored or failed. */
  public async drain(): Promise<void> {
    this.flushText();
    await this.writes.idle();
  }

  private flushText(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const pending = this.pendingText;
    if (pending === null) return;
    this.pendingText = null;
    const event: ChatJobTextEvent = { kind: "text", ...pending };
    void this.enqueue(event).catch(() => {
      // The reason was logged by enqueue; the next entry keeps the numbering.
    });
  }

  private enqueue(event: ChatJobEvent): Promise<void> {
    return this.writes.run(async () => {
      const sequence = this.sequence + 1;
      try {
        await this.repository.append(this.jobId, sequence, event);
      } catch (error: unknown) {
        // Only the kind of the entry is logged, never its text.
        console.error(
          "[pages] A Pica job entry could not be stored.",
          event.kind,
          error instanceof Error ? error.name : typeof error,
        );
        throw error;
      }
      this.sequence = sequence;
    });
  }
}
