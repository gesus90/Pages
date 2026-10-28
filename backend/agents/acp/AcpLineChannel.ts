import { logCaughtError } from "@/backend/logging/Logger";

import type { AnyMessage, Stream } from "@agentclientprotocol/sdk";

/** Whether a parsed line is a JSON-RPC message; the SDK validates its content. */
function isJsonRpcMessage(input: unknown): input is AnyMessage {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    Reflect.get(input, "jsonrpc") === "2.0"
  );
}

/**
 * Carries ACP messages over the line-based input and output of a session process.
 *
 * @remarks
 * The process keeps its existing guarantees: it reads complete lines, cuts a
 * runaway line, ends its whole process group and observes the deadline. This
 * channel only turns those lines into the message stream of the ACP SDK and
 * back. A line that is no JSON-RPC message is a diagnostic and is dropped.
 */
export class AcpLineChannel {
  public readonly stream: Stream;
  private controller: ReadableStreamDefaultController<AnyMessage> | null = null;
  private writeLine: ((line: string) => boolean | Promise<boolean>) | null =
    null;
  private isClosed = false;
  private isAcknowledged = false;
  private capacity: (() => void) | null = null;
  private pendingNotification: (() => void) | null = null;

  public constructor() {
    const readable = new ReadableStream<AnyMessage>({
      start: (controller) => {
        this.controller = controller;
      },
      pull: () => {
        this.capacity?.();
        this.capacity = null;
      },
      // A closed ACP connection cancels its reader; nothing may be enqueued or closed afterwards.
      cancel: () => {
        this.isClosed = true;
        this.acknowledge();
        this.capacity?.();
      },
    });
    const writable = new WritableStream<AnyMessage>({
      write: async (message) => {
        if (!(await this.writeLine?.(JSON.stringify(message))))
          throw new Error("The ACP adapter no longer reads its input.");
      },
    });
    this.stream = { readable, writable };
  }

  /** Connects the input of the started process; messages written before fail. */
  public attach(writeLine: (line: string) => boolean | Promise<boolean>): void {
    this.writeLine = writeLine;
  }

  /** Enables one-notification-at-a-time reading for a plan's persistent journal. */
  public enableAcknowledgement(): void {
    this.isAcknowledged = true;
  }

  /** Releases the native pipe after its notification was processed and persisted. */
  public acknowledge(): void {
    this.pendingNotification?.();
    this.pendingNotification = null;
  }

  /** Receives one complete output line of the process. */
  public receive(line: string): void | Promise<void> {
    if (this.isClosed) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (caughtError: unknown) {
      logCaughtError("AcpLineChannel", caughtError);

      return;
    }
    if (!isJsonRpcMessage(message)) return;
    return this.enqueue(message);
  }

  /** Ends the incoming messages once the process exited; pending requests then fail. */
  public close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.acknowledge();
    this.capacity?.();
    this.controller?.close();
  }
  private async enqueue(message: AnyMessage): Promise<void> {
    // An errored stream has no desired size; like a full one it takes nothing now.
    const hasCapacity = Number(this.controller?.desiredSize) > 0;
    if (!hasCapacity && !this.isClosed)
      await new Promise<void>((resolve) => {
        this.capacity = resolve;
      });
    if (this.isClosed) return;
    let processed: Promise<void> | undefined;
    if (
      this.isAcknowledged &&
      "method" in message &&
      message.method === "session/update"
    ) {
      processed = new Promise((resolve) => {
        this.pendingNotification = resolve;
      });
    }
    this.controller?.enqueue(message);
    await processed;
  }
}
