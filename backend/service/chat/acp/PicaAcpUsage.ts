import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";

import { sumJobUsage } from "./PicaAcpTurnResult";

import type { ChatJobRepository } from "@/backend/database/repositories/chat/ChatJobRepository";
import type {
  ChatContextUsage,
  ChatCost,
  ChatJobUsage,
  ChatTokenUsage,
} from "@/definition/ChatJob";
import type { PicaAcpJournal } from "./PicaAcpJournal";

/**
 * The usage of one Pica job: context, cost and the tokens of each turn.
 *
 * @remarks
 * Reports are stored one after another and each is followed by the summed
 * usage in the journal. A failed write is logged without content.
 */
export class PicaAcpUsage {
  private readonly jobs: Pick<ChatJobRepository, "saveContext" | "saveTurn">;
  private readonly journal: PicaAcpJournal;
  private readonly jobId: string;
  private readonly hasPartialTokenUsage: boolean;
  private readonly writes = new SerialQueue();
  private readonly tokens = new Map<
    number,
    Omit<ChatTokenUsage, "isPartial"> | null
  >();
  private usage: Pick<ChatJobUsage, "context" | "cost"> = {
    context: null,
    cost: null,
  };

  public constructor(
    jobs: Pick<ChatJobRepository, "saveContext" | "saveTurn">,
    journal: PicaAcpJournal,
    jobId: string,
    hasPartialTokenUsage: boolean,
  ) {
    this.jobs = jobs;
    this.journal = journal;
    this.jobId = jobId;
    this.hasPartialTokenUsage = hasPartialTokenUsage;
  }

  /** Replaces the context; a cost stays until the adapter reports another. */
  public recordContext(
    context: ChatContextUsage | null,
    cost: ChatCost | null,
  ): void {
    this.usage = { context, cost: cost ?? this.usage.cost };
    const { usage } = this;
    this.store(() => this.jobs.saveContext(this.jobId, context, usage.cost));
  }

  /** Keeps one entry per turn: a repeated report replaces it instead of counting twice. */
  public recordTokens(
    turn: number,
    tokens: Omit<ChatTokenUsage, "isPartial"> | null,
  ): void {
    this.tokens.set(turn, tokens);
    this.store(() =>
      this.jobs.saveTurn(this.jobId, turn, tokens, this.hasPartialTokenUsage),
    );
  }

  /** Waits for every report taken so far. */
  public idle(): Promise<void> {
    return this.writes.idle();
  }

  private store(save: () => Promise<void>): void {
    void this.writes
      .run(async () => {
        await save();
        await this.journal.record({ kind: "usage", usage: this.current() });
      })
      .catch((caughtError: unknown) => {
        logCaughtError("PicaAcpJob", caughtError);

        logDiagnostic(
          "PicaAcpJob",
          "error",
          "[pages] The usage of a Pica job could not be stored.",
        );
      });
  }

  private current(): ChatJobUsage {
    return sumJobUsage(
      this.usage,
      [...this.tokens.values()],
      this.hasPartialTokenUsage,
    );
  }
}
