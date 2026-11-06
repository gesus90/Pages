import { SerialQueue } from "@/backend/concurrency/SerialQueue";

import type {
  AgentCapabilities,
  SessionUpdate,
  Usage,
} from "@agentclientprotocol/sdk";
import type { AcpSessionListener } from "@/backend/agents/acp/AcpChat";
import type { AgentSessionRecorder } from "@/backend/service/agents/sessions/AgentSessionRecorder";
import type { LocalSessionJournal } from "./LocalSessionJournal";

/** Retains native chunks before aggregation, then lets the existing recorder project the same updates. */
export class LocalAcpJournalListener implements AcpSessionListener {
  private readonly recorder: AgentSessionRecorder;
  private readonly journal: LocalSessionJournal;
  private readonly writes = new SerialQueue();
  private pending: Promise<void> = Promise.resolve();
  private failure: unknown = null;

  public constructor(
    recorder: AgentSessionRecorder,
    journal: LocalSessionJournal,
  ) {
    this.recorder = recorder;
    this.journal = journal;
  }

  /** Records the actual adapter's capabilities before they become a public status event. */
  public readonly announced = (
    capabilities: AgentCapabilities | null | undefined,
  ): void => {
    this.enqueue("announced", capabilities ?? null, () =>
      this.recorder.announced(capabilities),
    );
  };

  /** Fsyncs every genuine, already credential-redacted native update, including partial message chunks. */
  public readonly update = (update: SessionUpdate): void => {
    this.enqueue("update", update, () => this.recorder.update(update));
  };

  /** Preserves the original native usage response before token projection. */
  public readonly prompted = (usage: Usage | null): void => {
    this.enqueue("prompted", usage, () => this.recorder.prompted(usage));
  };

  /** Records the native channel close before flushing its final message. */
  public readonly closed = (): void => {
    this.enqueue("closed", null, () => this.recorder.closed());
  };

  /** Keeps ACP backpressure until native custody and all public projection mutations are durable. */
  public readonly drained = async (): Promise<void> => {
    await this.pending;
    if (this.failure !== null) throw this.failure;
    await this.recorder.drained();
  };

  private enqueue(
    channel: "announced" | "update" | "prompted" | "closed",
    input: unknown,
    apply: () => void,
  ): void {
    const attemptId = this.recorder.current.key.attemptId;
    this.pending = this.writes.run(async () => {
      await this.journal.append({
        kind: "frame",
        attemptId,
        channel,
        body: JSON.stringify(input),
      });
      apply();
      await this.recorder.drained();
    });
    // drained() propagates the original failure to ACP; do not leave a temporarily unobserved rejection.
    void this.pending.catch((error: unknown) => {
      this.failure ??= error;
    });
  }
}
