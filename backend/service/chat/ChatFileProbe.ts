import { logCaughtError } from "@/backend/logging/Logger";

/** Bytes at the start of a file that identify its format. */
const HEAD_BYTES = 4096;

/** Bytes at the end of a file kept for the central directory of an Office file. */
const TAIL_BYTES = 8 * 1024 * 1024;

/** Largest SVG whose markup is kept for the safety check. */
const CHAT_SVG_BYTES = 1024 * 1024;

/** Control characters that never occur in a text file; tab, line breaks and form feed do. */
const BINARY_CHARACTERS = new RegExp(
  "[\\u0000-\\u0008\\u000b\\u000e-\\u001f\\u007f]",
  "u",
);

/** What the content of an upload revealed while it streamed to the disk. */
export interface ChatFileFacts {
  readonly size: number;
  readonly head: Buffer;
  /** The last bytes of the file, at most 8 MiB. */
  readonly tail: Buffer;
  /** Whether the whole file is UTF-8 text without binary control characters. */
  readonly isText: boolean;
  /** The complete file while it is small enough to be an inspected SVG, else `null`. */
  readonly markup: Buffer | null;
}

/**
 * Collects the facts that decide the type of an upload in one pass, so the
 * file is never read into memory as a whole.
 */
export class ChatFileProbe {
  private size = 0;
  private head = Buffer.alloc(0);
  private readonly tail: Buffer[] = [];
  private tailBytes = 0;
  private markup: Buffer[] | null = [];
  private isText = true;
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });

  /**
   * Passes the bytes of an upload through unchanged while observing them.
   *
   * @param source - The bytes as they arrive.
   * @returns The same bytes.
   */
  public async *observe(
    source: AsyncIterable<Uint8Array>,
  ): AsyncGenerator<Uint8Array> {
    for await (const chunk of source) {
      this.inspect(Buffer.from(chunk));
      yield chunk;
    }
  }

  /** Completes the observation once every byte has passed. */
  public facts(): ChatFileFacts {
    this.decode(null);
    return {
      size: this.size,
      head: this.head,
      tail: Buffer.concat(this.tail).subarray(-TAIL_BYTES),
      isText: this.isText,
      markup: this.markup === null ? null : Buffer.concat(this.markup),
    };
  }

  private inspect(chunk: Buffer): void {
    this.size += chunk.length;
    if (this.head.length < HEAD_BYTES)
      this.head = Buffer.concat([this.head, chunk]).subarray(0, HEAD_BYTES);
    this.keepTail(chunk);
    if (this.markup !== null)
      this.markup = this.size > CHAT_SVG_BYTES ? null : [...this.markup, chunk];
    this.decode(chunk);
  }

  private keepTail(chunk: Buffer): void {
    this.tail.push(chunk);
    this.tailBytes += chunk.length;
    while (this.tailBytes - this.tail[0].length >= TAIL_BYTES) {
      this.tailBytes -= this.tail[0].length;
      this.tail.shift();
    }
  }

  private decode(chunk: Buffer | null): void {
    if (!this.isText) return;
    try {
      const text =
        chunk === null
          ? this.decoder.decode()
          : this.decoder.decode(chunk, { stream: true });
      this.isText = !BINARY_CHARACTERS.test(text);
    } catch (caughtError: unknown) {
      logCaughtError("ChatFileProbe", caughtError);

      this.isText = false;
    }
  }
}
