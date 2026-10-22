import type { SetupProgress } from "@/definition/RemoteSetup";

/** What a conductor may do to the console that runs it. */
export interface ConductorControl {
  /** Replaces the progress shown above the terminal. */
  readonly report: (progress: SetupProgress) => void;
  /** Types text into the terminal as a person would; ignored while no terminal runs. */
  readonly write: (input: string) => void;
}

/** How the terminal of a guided run ended. */
export interface ConductorExit {
  readonly exitCode: number;
  /** Whether the machine refused the terminal or the SSH transport itself failed. */
  readonly isTransportFailure: boolean;
}

/**
 * Drives a guided run inside a console, in place of a shell a person types into.
 *
 * @remarks
 * A conducted console never restarts its command on its own: a lost
 * transport ends the run instead of starting it a second time.
 */
export interface RemoteConsoleConductor {
  /** The command line that replaces the login shell. */
  readonly command: string;
  /** Whether the command started; only a run that did not start may be retried by a person. */
  hasStarted(): boolean;
  /** Runs before the terminal opens; an error stops the run before anything starts. */
  prepare(control: ConductorControl): Promise<void>;
  /** Called when the terminal is open. */
  terminalOpened(control: ConductorControl): void;
  /** Takes raw terminal output and returns the text a person sees. */
  filter(chunk: string, control: ConductorControl): string;
  /** Called once when the terminal ended, before the console reports its end. */
  finish(exit: ConductorExit, control: ConductorControl): Promise<void>;
  /** Called when the run failed before or outside the terminal. */
  abort(error: unknown, control: ConductorControl): void;
}
