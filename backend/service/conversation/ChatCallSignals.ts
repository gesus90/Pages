import type {
  ChatCallSignal,
  ChatCallSignalMessage,
} from "@/definition/ChatCall";

/** The most signals a call keeps; older ones fall away, as the browsers read them at once. */
const MAXIMUM_SIGNALS = 400;

interface StoredSignal extends ChatCallSignalMessage {
  readonly senderId: string;
}

interface SignalBox {
  nextSequence: number;
  signals: StoredSignal[];
}

interface Waiter {
  readonly callId: string;
  readonly readerId: string;
  readonly wake: () => void;
}

/**
 * The connection offers, answers and ICE candidates two browsers pass on
 * through the server, kept in memory for as long as their call runs.
 * @remarks
 * The box only stores and orders; who may write or read is decided by the
 * service before it calls the box. A reader only receives what the other
 * person sent.
 */
export class ChatCallSignals {
  private readonly boxes = new Map<string, SignalBox>();
  private readonly waiters = new Set<Waiter>();

  /**
   * Stores a signal of one participant for the other.
   * @param callId - The call.
   * @param senderId - The account that sent the signal.
   * @param signal - The offer, answer or candidate.
   */
  public append(
    callId: string,
    senderId: string,
    signal: ChatCallSignal,
  ): void {
    const box = this.boxes.get(callId) ?? { nextSequence: 1, signals: [] };
    box.signals.push({ sequence: box.nextSequence, senderId, signal });
    box.nextSequence += 1;
    if (box.signals.length > MAXIMUM_SIGNALS)
      box.signals.splice(0, box.signals.length - MAXIMUM_SIGNALS);
    this.boxes.set(callId, box);
    this.wake(callId, senderId);
  }

  /**
   * Reads the signals of the other participant after a position.
   * @param callId - The call.
   * @param readerId - The account that reads; its own signals are skipped.
   * @param after - The sequence of the last signal it has seen, `0` for none.
   */
  public read(
    callId: string,
    readerId: string,
    after: number,
  ): readonly ChatCallSignalMessage[] {
    const box = this.boxes.get(callId);
    if (box === undefined) return [];
    return box.signals
      .filter((entry) => entry.sequence > after && entry.senderId !== readerId)
      .map(({ sequence, signal }) => ({ sequence, signal }));
  }

  /**
   * Waits until the other participant sends a signal, the call closes, the
   * request is dropped or the time is up.
   * @param callId - The call.
   * @param readerId - The account that waits.
   * @param options - How long to wait and the signal of the dropped request.
   */
  public wait(
    callId: string,
    readerId: string,
    options: { readonly milliseconds: number; readonly abort: AbortSignal },
  ): Promise<void> {
    return new Promise((resolve) => {
      const waiter: Waiter = {
        callId,
        readerId,
        wake: () => {
          clearTimeout(timer);
          options.abort.removeEventListener("abort", waiter.wake);
          this.waiters.delete(waiter);
          resolve();
        },
      };
      const timer = setTimeout(waiter.wake, options.milliseconds);
      options.abort.addEventListener("abort", waiter.wake, { once: true });
      this.waiters.add(waiter);
      if (options.abort.aborted) waiter.wake();
    });
  }

  /**
   * Drops the signals of an ended call and wakes everybody who waits for it.
   * @param callId - The call.
   */
  public close(callId: string): void {
    this.boxes.delete(callId);
    this.wake(callId, null);
  }

  private wake(callId: string, exceptReaderId: string | null): void {
    for (const waiter of [...this.waiters])
      if (waiter.callId === callId && waiter.readerId !== exceptReaderId)
        waiter.wake();
  }
}
