import { Writable } from "node:stream";
import type { RunnerExecution } from "../../definition/RunnerExecution";
import type { RunnerJob } from "../../definition/RunnerProtocol";
import type { RunnerTerminal } from "../../definition/RunnerTerminal";
import type { JournalBinding } from "./chunks.mjs";
export class JobOutput extends Writable {
  constructor(
    command: RunnerExecution,
    folder: string,
    binding: JournalBinding,
    redact: (text: string) => string,
  );
  initialize(folder: string): Promise<void>;
  close(): Promise<void>;
  result(): {
    output: string;
    stderr: string;
    reason?: string | null;
    terminal?: RunnerTerminal;
  };
}
export function outputBinding(
  job: RunnerJob,
  launch: { id: string },
): JournalBinding;
