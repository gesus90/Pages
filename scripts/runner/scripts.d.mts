import type { ChildProcessWithoutNullStreams } from "node:child_process";

/** Interpreter profile pinned by the plan, with the digest the worker rechecks. */
export interface ScriptInterpreter {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly digest: string;
  readonly version: string;
}
/** The part of a dispatched execution that a script needs. */
export interface ScriptCommand {
  readonly workspace: string;
  readonly timeoutSeconds: number;
  readonly program: {
    readonly interpreter: ScriptInterpreter;
    readonly source: string;
  };
}
/** Rechecks the interpreter digest, then writes the private source (and Node guard) into the runtime folder. */
export function prepareScript(
  command: ScriptCommand,
  runtime: string,
): Promise<void>;
/** The tool search path of a script: the directory of the advertised Node binary, then the system directories. */
export function scriptSearchPath(nodeExecutable?: string): string;
/** The complete script environment; nothing is inherited from the runner service. */
export function scriptEnvironment(
  runtime: string,
  jobId: string,
  nodeExecutable?: string,
): Record<string, string>;
/** The `prlimit` arguments shared by every script interpreter. */
export function scriptLimits(
  timeoutSeconds: number,
  accountTaskCount: number,
): string[];
/** Starts the prepared script under the per-process limits. */
export function spawnScript(
  command: ScriptCommand,
  folder: string,
  jobId: string,
): ChildProcessWithoutNullStreams;
