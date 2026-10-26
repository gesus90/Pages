/** One JSON/ACP event may span packets and storage chunks, but may never grow without a bound. */
export const MAXIMUM_PROTOCOL_LINE_BYTES = 8 * 1024 * 1024;

/** Fatal UTF-8 decoding and bounded complete-line delivery, with an awaited downstream consumer. */
export class ProtocolLines {
  #decoder = new TextDecoder("utf-8", { fatal: true });
  #pending = "";
  #bytes = 0;
  #receive;

  constructor(receive) {
    this.#receive = receive;
  }

  /** Decodes split UTF-8 characters and awaits every complete logical record in order. */
  async receive(chunk) {
    await this.#read(this.#decoder.decode(chunk, { stream: true }));
  }

  /** Flushes only complete text; a malformed trailing JSON line is rejected by its consumer. */
  async finish() {
    await this.#read(this.#decoder.decode());
    if (this.#pending.trim()) await this.#receive(this.#pending);
    this.#pending = "";
    this.#bytes = 0;
  }

  async #read(text) {
    let start = 0;
    for (;;) {
      const end = text.indexOf("\n", start);
      const part = text.slice(start, end < 0 ? undefined : end);
      this.#bytes += Buffer.byteLength(part);
      if (this.#bytes > MAXIMUM_PROTOCOL_LINE_BYTES)
        throw Object.assign(new Error("CLI/ACP event exceeds 8 MiB"), {
          reason: "event_limit",
        });
      this.#pending += part;
      if (end < 0) return;
      if (this.#pending.trim()) await this.#receive(this.#pending);
      this.#pending = "";
      this.#bytes = 0;
      start = end + 1;
    }
  }
}
