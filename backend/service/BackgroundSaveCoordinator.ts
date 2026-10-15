import { SerialQueue } from "@/backend/concurrency/SerialQueue";

/** Refuses a request superseded by a newer edit from the same document. */
export class SupersededBackgroundSaveError extends Error {}

/** Identifies a document's ordered writes to one object for one account. */
export interface BackgroundSaveOrder {
  readonly actorId: string;
  readonly objectId: string;
  readonly streamId: string;
  readonly sequence: number;
}

interface WriteStream {
  sequence: number;
  readonly queue: SerialQueue;
}

/**
 * Fences late HTTP requests as well as serializing writes that already started.
 *
 * @remarks
 * Pages has one Node.js process, as does SerialQueue. This metadata lives for
 * that process: a restarted process cannot finish any old in-flight request.
 * Revisions and text comparisons still protect edits from other documents.
 */
export class BackgroundSaveCoordinator {
  private readonly streams = new Map<string, WriteStream>();

  /** Executes a new sequence exclusively; consumed sequences never write twice. */
  public run<Result>(
    order: BackgroundSaveOrder,
    work: () => Promise<Result>,
  ): Promise<Result> {
    const key = JSON.stringify([order.actorId, order.objectId, order.streamId]);
    let stream = this.streams.get(key);
    if (!stream) {
      stream = { sequence: 0, queue: new SerialQueue() };
      this.streams.set(key, stream);
    }
    const current = stream;
    return current.queue.run(async () => {
      if (order.sequence <= current.sequence) {
        throw new SupersededBackgroundSaveError();
      }
      current.sequence = order.sequence;
      return work();
    });
  }
}

/** Shared across all background-save resource requests in the server process. */
export const backgroundSaveCoordinator = new BackgroundSaveCoordinator();
