import type { RunnerExecution } from "../../definition/RunnerExecution";
import type { RunnerTerminal } from "../../definition/RunnerTerminal";
export class CliTerminalResult {
  constructor(command: RunnerExecution, redact: (text: string) => string);
  receive(event: unknown): void;
  result(): {
    output: string;
    reason: string | null;
    terminal?: RunnerTerminal;
    failureCode?: string;
  };
}
