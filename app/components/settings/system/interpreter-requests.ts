import { z } from "zod";

import { interpreterProfilesSchema } from "@/definition/InterpreterProfile";

import type {
  InterpreterCheck,
  InterpreterProfile,
  InterpreterSnapshot,
} from "@/definition/InterpreterProfile";

const checkSchema = z.object({
  path: z.string(),
  status: z.enum(["ok", "error"]),
  version: z.string().nullable(),
  error: z
    .enum([
      "missing",
      "notExecutable",
      "timeout",
      "outputLimit",
      "exit",
      "noVersion",
      "failed",
    ])
    .optional(),
  diagnostic: z.string().optional(),
});
const snapshotSchema = z.object({
  profiles: interpreterProfilesSchema,
  revision: z.string(),
  checks: z.record(z.string(), checkSchema),
});

async function post(form: Record<string, string>): Promise<unknown> {
  const response = await fetch("/settings-api/interpreters", {
    method: "POST",
    body: new URLSearchParams(form),
  });
  return response.json();
}

/** Reads a single path-bound observation without persisting an editor draft. */
export async function requestInterpreterCheck(
  profile: InterpreterProfile,
): Promise<InterpreterCheck> {
  try {
    const response = z
      .object({ check: checkSchema })
      .parse(await post({ intent: "check", ...profile }));
    return response.check;
  } catch {
    return {
      path: profile.path,
      status: "error",
      version: null,
      error: "failed",
    };
  }
}

interface InterpreterSaveFailure {
  readonly error: string;
  readonly checks: Readonly<Record<string, InterpreterCheck>>;
}

/** Saves against the original revision and returns the exact confirmed configuration. */
export async function requestInterpreterSave(
  profiles: readonly InterpreterProfile[],
  revision: string,
): Promise<InterpreterSnapshot | InterpreterSaveFailure> {
  const response = await post({
    intent: "save",
    profiles: JSON.stringify(profiles),
    revision,
  });
  const success = z.object({ snapshot: snapshotSchema }).safeParse(response);
  if (success.success) return success.data.snapshot;
  return z
    .object({
      error: z.enum(["invalid", "conflict", "unchecked", "general"]),
      checks: z.record(z.string(), checkSchema).default({}),
    })
    .parse(response);
}
