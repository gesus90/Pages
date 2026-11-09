/**
 * Hands the chunks of a voice upload to the file store as one stream.
 *
 * @remarks
 * Chunks arrive one frame at a time and are queued until the store reads
 * them; the queue holds at most what the connection let through. Ending the
 * feed ends the stream, failing it makes the store drop the partial file.
 */
export class PicaMobileVoiceFeed implements AsyncIterable<Uint8Array> {
  private readonly chunks: Buffer[] = [];
  private wake: (() => void) | null = null;
  private isEnded = false;
  private failure: Error | null = null;

  /** Queues the next chunk; chunks after the end are ignored. */
  public push(chunk: Buffer): void {
    if (this.isEnded || this.failure !== null) return;
    this.chunks.push(chunk);
    this.notify();
  }

  /** Ends the stream after the queued chunks. */
  public end(): void {
    this.isEnded = true;
    this.notify();
  }

  /** Breaks the stream off; the reader receives the error. */
  public fail(error: Error): void {
    this.failure = error;
    this.chunks.length = 0;
    this.notify();
  }

  /** Reads the chunks in their order until the end or the failure. */
  public async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
    for (;;) {
      if (this.failure !== null) throw this.failure;
      const chunk = this.chunks.shift();
      if (chunk !== undefined) {
        yield chunk;
        continue;
      }
      if (this.isEnded) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }
}
