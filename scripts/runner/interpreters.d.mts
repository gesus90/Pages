import type { ScriptInterpreter } from "./scripts.mjs";

/** The interpreters of this host; `isComplete` is false when a probe failed for another reason than absence. */
export function interpreterCatalog(): Promise<{
  interpreters: ScriptInterpreter[];
  isComplete: boolean;
}>;
/** Probes the exact executables again, for the worker-side check before a start. */
export function interpreters(): Promise<ScriptInterpreter[]>;
