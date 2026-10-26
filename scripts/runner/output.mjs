import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Writable } from "node:stream";

import { ChunkJournal } from "./chunks.mjs";
import { createLiveHistory } from "./live.mjs";
import { ProtocolLines } from "./lines.mjs";
import { CliTerminalResult } from "./result.mjs";

/** Immutable journal owner, including the actual native worker launch. */
export function outputBinding(job, launch) {
  return {
    jobId: job.jobId,
    sessionId: job.sessionId,
    plan: job.plan,
    launchId: launch.id,
  };
}

/** Bounded process output sink; the caller pauses both pipes when its two-packet queue fills. */
export class JobOutput extends Writable {
  #raw;
  #events;
  #terminal;
  #history;
  #command;
  #redact;
  #stdout;
  #stderr;
  #sequence = 0;
  #eventSequence = 0;
  #diagnostic = "";
  #scriptOutput = "";
  #scriptDecoder = new TextDecoder("utf-8", { fatal: true });
  #scriptBytes = 0;
  #isPrivateKey = false;
  #checkpointAt = 0;
  #checkpointTimer = null;

  constructor(command, folder, binding, redact) {
    super({ objectMode: true, highWaterMark: 2 });
    this.#command = command;
    this.#redact = redact;
    this.#raw = new ChunkJournal(join(folder, "history", "raw"), binding);
    this.#events = new ChunkJournal(
      join(folder, "history", "events"),
      binding,
      { recordAligned: true },
    );
    this.#terminal = new CliTerminalResult(command, redact);
    this.#history = createLiveHistory(command, redact, async (event) => {
      this.#eventSequence += 1;
      await this.#events.append(
        Buffer.from(
          `${JSON.stringify({ sequence: this.#eventSequence, ...event })}\n`,
        ),
        this.#eventSequence,
      );
    });
    this.#stdout = new ProtocolLines(async (line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        if (line.trimStart().startsWith("{"))
          throw Object.assign(new Error("Malformed CLI JSON event"), {
            reason: "protocol",
          });
        return;
      }
      this.#terminal.receive(event);
      await this.#history.receive(event);
    });
    this.#stderr = new ProtocolLines(async (line) => {
      if (line.includes("-----BEGIN") && line.includes("PRIVATE KEY-----"))
        this.#isPrivateKey = true;
      if (!this.#isPrivateKey)
        this.#diagnostic = `${this.#diagnostic}${redact(line)}\n`.slice(-16384);
      if (line.includes("-----END") && line.includes("PRIVATE KEY-----"))
        this.#isPrivateKey = false;
    });
  }

  /** Creates both private raw and public event streams before the child is allowed to run. */
  async initialize(folder) {
    await mkdir(join(folder, "history"), { mode: 0o700 });
    await this.#raw.initialize();
    await this.#events.initialize();
  }

  /** Serialized by Writable; storage and parser consumers must complete before another packet is accepted. */
  _write(packet, encoding, callback) {
    this.#receive(packet).then(() => callback(), callback);
  }

  /** Final result is separated from the history before its native closeout is reported. */
  _final(callback) {
    this.#finish().then(() => callback(), callback);
  }

  /** Returns only the bounded final answer and diagnostic tail, never concatenated log chunks. */
  result() {
    if (this.#command.program.kind !== "cli")
      return {
        output: this.#redact(this.#scriptOutput),
        stderr: this.#diagnostic,
      };
    return { ...this.#terminal.result(), stderr: this.#diagnostic };
  }

  /** A failed storage path still closes its descriptors and attempts to preserve the confirmed prefix. */
  async close() {
    clearTimeout(this.#checkpointTimer);
    this.#checkpointTimer = null;
    const outcomes = await Promise.allSettled([
      this.#raw.close(),
      this.#events.close(),
    ]);
    const failed = outcomes.find((outcome) => outcome.status === "rejected");
    if (failed) throw failed.reason;
  }

  async #receive(packet) {
    if (packet.checkpoint) {
      await this.#checkpoint();
      return;
    }
    const { chunk, channel } = packet;
    const header = Buffer.alloc(13);
    this.#sequence += 1;
    header.writeUInt8(channel === "stdout" ? 1 : 2);
    header.writeUInt32BE(chunk.length, 1);
    header.writeBigUInt64BE(BigInt(this.#sequence), 5);
    await this.#raw.append(Buffer.concat([header, chunk]), this.#sequence);
    if (this.#command.program.kind !== "cli") {
      this.#scriptBytes += chunk.length;
      if (this.#scriptBytes > this.#command.outputBytes)
        throw Object.assign(new Error("Script result limit exceeded"), {
          reason: "output_limit",
        });
      if (channel === "stdout")
        this.#scriptOutput += this.#scriptDecoder.decode(chunk, {
          stream: true,
        });
      else await this.#stderr.receive(chunk);
    } else
      await (channel === "stdout" ? this.#stdout : this.#stderr).receive(chunk);
    if (Date.now() - this.#checkpointAt < 250) {
      this.#scheduleCheckpoint();
      return;
    }
    await this.#checkpoint();
  }

  #scheduleCheckpoint() {
    if (this.#checkpointTimer !== null) return;
    this.#checkpointTimer = setTimeout(
      () => {
        this.#checkpointTimer = null;
        if (this.destroyed || this.writableEnded || this.writableLength > 0)
          return;
        this.write({ checkpoint: true });
      },
      Math.max(1, this.#checkpointAt + 250 - Date.now()),
    );
  }

  async #checkpoint() {
    clearTimeout(this.#checkpointTimer);
    this.#checkpointTimer = null;
    await this.#raw.checkpoint();
    await this.#events.checkpoint();
    this.#checkpointAt = Date.now();
  }

  async #finish() {
    if (this.#command.program.kind === "cli") {
      await this.#stdout.finish();
      await this.#history.finish();
    }
    if (this.#command.program.kind !== "cli")
      this.#scriptOutput += this.#scriptDecoder.decode();
    await this.#stderr.finish();
    await this.close();
  }
}
