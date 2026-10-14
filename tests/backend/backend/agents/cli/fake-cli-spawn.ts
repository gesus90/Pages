import { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";

import { ndJsonStream } from "@agentclientprotocol/sdk";

import { fakeAcpAgent } from "../acp/fake-acp-adapter";

import type { SpawnOptions } from "node:child_process";
import type {
  CliGroupSignal,
  CliSpawn,
} from "@/backend/agents/cli/CliContracts";
import type { FakeAdapterOptions, ReceivedCall } from "../acp/fake-acp-adapter";

const PROCESS_ID = 4242;

/** One process the code under test started. */
export interface SpawnedProcess {
  readonly file: string;
  readonly arguments: readonly string[];
  readonly options: SpawnOptions;
}

/** A spawn stand-in whose processes speak ACP like the Codex adapter. */
export interface FakeCliSpawn {
  readonly spawn: CliSpawn;
  readonly signalGroup: CliGroupSignal;
  readonly spawned: SpawnedProcess[];
  /** What the fake adapter received over ACP. */
  readonly calls: ReceivedCall[];
}

function streams(child: ChildProcess): {
  readonly stdin: PassThrough;
  readonly stdout: PassThrough;
} {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  Object.defineProperty(child, "stdin", { value: stdin });
  Object.defineProperty(child, "stdout", { value: stdout });
  Object.defineProperty(child, "stderr", { value: new PassThrough() });
  Object.defineProperty(child, "pid", { value: PROCESS_ID });
  return { stdin, stdout };
}

// The adapter side reads what Pages writes to the input of the process.
function readableOf(input: PassThrough): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      input.on("data", (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      input.on("end", () => controller.close());
    },
  });
}

// The adapter side writes what Pages reads from the output of the process.
function writableOf(output: PassThrough): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write: (chunk) => {
      output.write(chunk);
    },
  });
}

function exit(
  child: ChildProcess,
  code: number | null,
  signal: NodeJS.Signals | null,
): void {
  child.stdout?.removeAllListeners("data");
  child.emit("exit", code, signal);
  child.emit("close", code, signal);
}

/**
 * Creates a spawn that starts a fake Codex ACP adapter for every process.
 *
 * @param options - How the fake adapter behaves.
 * @returns The spawn, the group signal and what was started and received.
 *
 * @remarks
 * Closing the input ends the process with code 0; a group signal ends it with
 * that signal. Every process speaks ACP, so a test of another runner only
 * looks at what was started.
 */
export function fakeCliSpawn(options: FakeAdapterOptions = {}): FakeCliSpawn {
  const spawned: SpawnedProcess[] = [];
  const children: ChildProcess[] = [];
  const fake = fakeAcpAgent(options);
  const spawn: CliSpawn = (file, args, spawnOptions) => {
    spawned.push({ file, arguments: args, options: spawnOptions });
    const child = new ChildProcess();
    const { stdin, stdout } = streams(child);
    children.push(child);
    fake.app.connect(ndJsonStream(writableOf(stdout), readableOf(stdin)));
    stdin.on("finish", () => exit(child, 0, null));
    return child;
  };
  const signalGroup: CliGroupSignal = (processId, signal) => {
    for (const child of children)
      if (child.pid === -processId) exit(child, null, signal);
  };
  return { spawn, signalGroup, spawned, calls: fake.calls };
}
