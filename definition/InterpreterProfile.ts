import { z } from "zod";

/** A stable profile identity is independent of its label and detected version. */
export interface InterpreterProfile {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}

/** Only explicit absolute executable paths, never command lines, are accepted. */
export const interpreterProfileSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9-]+$/u),
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[^\x00-\x1f\x7f]+$/u),
  path: z
    .string()
    .min(2)
    .max(4096)
    .startsWith("/")
    .refine(
      (candidate) =>
        candidate === candidate.trim() &&
        !/[\x00-\x1f\x7f|;<>`]|\s--?\w/u.test(candidate),
    ),
});

/** Validates bounded, nonempty profile lists and unique names and identities. */
export const interpreterProfilesSchema = z
  .array(interpreterProfileSchema)
  .min(3)
  .max(32)
  .superRefine((profiles, context) => {
    for (const key of ["id", "name"] as const) {
      const entries = profiles.map((profile) =>
        profile[key].toLocaleLowerCase("en"),
      );
      if (new Set(entries).size !== entries.length)
        context.addIssue({
          code: "custom",
          message: `Duplicate profile ${key}`,
        });
    }
  });

export type InterpreterFailure =
  | "missing"
  | "notExecutable"
  | "timeout"
  | "outputLimit"
  | "exit"
  | "noVersion"
  | "failed";

/** Volatile observation, bound to the exact executable path that was checked. */
export interface InterpreterCheck {
  readonly path: string;
  readonly status: "ok" | "error";
  readonly version: string | null;
  readonly error?: InterpreterFailure;
  readonly diagnostic?: string;
}

/**
 * A profile Pages manages itself: it starts the active managed runtime generation.
 * @remarks
 * `path` is the concrete program of the generation new starts use;
 * `retainedPaths` also names the previous generation, which a run prepared
 * before a switch may still start.
 */
export interface ManagedInterpreterProfile extends InterpreterProfile {
  readonly version: string | null;
  readonly retainedPaths: readonly string[];
}

/** Snapshot used for optimistic concurrency; checks are never persisted. */
export interface InterpreterSnapshot {
  readonly profiles: readonly InterpreterProfile[];
  readonly checks: Readonly<Record<string, InterpreterCheck>>;
  readonly revision: string;
  /** Pages-managed profiles; present only where scripts are started, never in the editable settings. */
  readonly managed?: readonly ManagedInterpreterProfile[];
}
