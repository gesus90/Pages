import type { AcpSteerOutcome } from "@/backend/agents/acp/AcpChat";
import type { StoredChatAttachment } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import type { ChatSteerStatus } from "@/definition/ChatJob";

/** One message of a job: the message that started it, a steer or a follow-up. */
export interface PicaAcpMessage {
  readonly id: string;
  readonly text: string;
  readonly attachments: readonly StoredChatAttachment[];
}

/** A message that needs a turn of its own, and who started that turn. */
export interface PicaAcpQueuedTurn {
  /** `adapter`: codex-acp already runs it; `pages`: Pages prompts it next. */
  readonly origin: "adapter" | "pages";
  readonly message: PicaAcpMessage;
}

/** What steering needs from its job. */
export interface PicaAcpSteeringHost {
  /** Runs a task in the queue of the conversation, the same queue new messages pass. */
  readonly gate: <Result>(task: () => Promise<Result>) => Promise<Result>;
  readonly status: (
    messageId: string,
    status: ChatSteerStatus,
  ) => Promise<void>;
  /** Whether a prompt of Pages runs, so a steer can join its turn. */
  readonly isTurnRunning: () => boolean;
  /** Sends the steer to the running turn. */
  readonly deliver: (message: PicaAcpMessage) => Promise<AcpSteerOutcome>;
}

/**
 * The messages a person sends while a Pica job answers (PAGE-68).
 *
 * @remarks
 * A message that arrives while the turn of Pages runs goes to that same turn
 * through codex-acp's steering; it never cancels the turn. A message that
 * arrives between turns, or that the adapter no longer takes, is answered in
 * a turn of its own after the current one. When the adapter itself started a
 * turn for a steer because its turn ended meanwhile, that turn is followed
 * until it ends. The job closes only inside the queue of the conversation, so
 * a message is either taken by this job or starts the next one.
 */
export class PicaAcpSteering {
  private readonly host: PicaAcpSteeringHost;
  private readonly followUps: PicaAcpMessage[] = [];
  private readonly adapterTurns: PicaAcpMessage[] = [];
  private readonly deliveries = new Set<Promise<void>>();
  /** Steers that did not end yet: pending, delivered or waiting for their turn. */
  private readonly open = new Set<string>();
  private isClosed = false;

  public constructor(host: PicaAcpSteeringHost) {
    this.host = host;
  }

  /** Whether the job still takes messages; checked inside the queue of the conversation. */
  public isAccepting(): boolean {
    return !this.isClosed;
  }

  /**
   * Takes a stored message; call it inside the queue of the conversation.
   *
   * @returns `pending`, or `null` once the job no longer takes messages.
   */
  public async accept(
    message: PicaAcpMessage,
  ): Promise<ChatSteerStatus | null> {
    if (this.isClosed) return null;
    this.open.add(message.id);
    await this.host.status(message.id, "pending");
    const delivery = this.route(message);
    this.deliveries.add(delivery);
    void delivery.finally(() => this.deliveries.delete(delivery));
    return "pending";
  }

  /** Resolves once every steer sent so far has its outcome. */
  public async settle(): Promise<void> {
    while (this.deliveries.size > 0)
      await Promise.allSettled([...this.deliveries]);
  }

  /**
   * The next message that needs a turn of its own, or `null` when none is left.
   *
   * @remarks
   * `null` also closes the job for further messages, inside the queue of the
   * conversation, after every steer has its outcome.
   */
  public async next(): Promise<PicaAcpQueuedTurn | null> {
    for (;;) {
      await this.settle();
      const next = await this.host.gate(() => Promise.resolve(this.take()));
      if (next !== undefined) return next;
    }
  }

  /** The turn of a follow-up message ended with its answer; its status stays `followUp`. */
  public answered(messageId: string): void {
    this.open.delete(messageId);
  }

  /** Closes the job for further messages; every steer still open failed. */
  public async close(): Promise<void> {
    await this.host.gate(() => {
      this.isClosed = true;
      return Promise.resolve();
    });
    await this.settle();
    const failed = [...this.open];
    this.open.clear();
    this.followUps.length = 0;
    this.adapterTurns.length = 0;
    for (const messageId of failed) await this.host.status(messageId, "failed");
  }

  private take(): PicaAcpQueuedTurn | null | undefined {
    // A steer that is still on its way may still need a turn: settle again.
    if (this.deliveries.size > 0) return undefined;
    const adapter = this.adapterTurns.shift();
    if (adapter) return { origin: "adapter", message: adapter };
    const followUp = this.followUps.shift();
    if (followUp) return { origin: "pages", message: followUp };
    this.isClosed = true;
    return null;
  }

  private async route(message: PicaAcpMessage): Promise<void> {
    try {
      if (!this.host.isTurnRunning()) {
        await this.queue(message);
        return;
      }
      await this.host.status(message.id, "delivered");
      await this.settleOutcome(message, await this.host.deliver(message));
    } catch {
      // The adapter or the database refused; the message did not reach the agent.
      this.open.delete(message.id);
      await this.host.status(message.id, "failed").catch(() => undefined);
    }
  }

  private async settleOutcome(
    message: PicaAcpMessage,
    outcome: AcpSteerOutcome,
  ): Promise<void> {
    switch (outcome) {
      case "injected":
        this.open.delete(message.id);
        await this.host.status(message.id, "accepted");
        return;
      case "startedNewTurn":
        this.adapterTurns.push(message);
        await this.host.status(message.id, "followUp");
        return;
      case "inactive":
        await this.queue(message);
        return;
      case "failed":
        this.open.delete(message.id);
        await this.host.status(message.id, "failed");
        return;
    }
  }

  private async queue(message: PicaAcpMessage): Promise<void> {
    this.followUps.push(message);
    await this.host.status(message.id, "followUp");
  }
}
