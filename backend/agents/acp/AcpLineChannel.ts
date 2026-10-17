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
  private writeLine: ((line: string) => boolean) | null = null;
  private isClosed = false;

  public constructor() {
    const readable = new ReadableStream<AnyMessage>({
      start: (controller) => {
        this.controller = controller;
      },
      // A closed ACP connection cancels its reader; nothing may be enqueued or closed afterwards.
      cancel: () => {
        this.isClosed = true;
      },
    });
    const writable = new WritableStream<AnyMessage>({
      write: (message) => {
        if (!this.writeLine?.(JSON.stringify(message)))
          throw new Error("The ACP adapter no longer reads its input.");
      },
    });
    this.stream = { readable, writable };
  }

  /** Connects the input of the started process; messages written before fail. */
  public attach(writeLine: (line: string) => boolean): void {
    this.writeLine = writeLine;
  }

  /** Receives one complete output line of the process. */
  public receive(line: string): void {
    if (this.isClosed) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (caughtError: unknown) {
      logCaughtError("AcpLineChannel", caughtError);

      return;
    }
    if (isJsonRpcMessage(message)) this.controller?.enqueue(message);
  }

  /** Ends the incoming messages once the process exited; pending requests then fail. */
  public close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.controller?.close();
  }
}
