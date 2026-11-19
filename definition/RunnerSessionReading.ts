import { z } from "zod";

/** The characters a CLI model identifier may have; anything else is refused, never cut. */
const MODEL_NAME = /^[A-Za-z0-9._:@/[\]-]{1,200}$/u;
const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/**
 * Where the occupancy of a CLI session's context comes from: the latest
 * top-level answer or a compaction of Claude Code, the `token_count` record
 * of a Codex rollout, or an ACP `usage_update` from OpenCode.
 */
export const RUNNER_CONTEXT_SOURCES = [
  "cli_assistant_usage",
  "cli_compact_boundary",
  "codex_token_count",
  "acp_usage_update",
] as const;

/**
 * A model selection or context reading sent by a native runner job.
 * @remarks
 * It travels as a `usage` event beside the token counters, but as an object
 * of its own: `model` is the model the CLI reported, `context.used` the
 * occupancy of the latest top-level answer or the count a compaction kept,
 * `context.limit` the window the CLI's result named for exactly that model.
 * For Codex, `used` is `last_token_usage.total_tokens` and `limit` is
 * `model_context_window` of the rollout, the model is the one of its
 * `turn_context`; a reading with a window but no occupancy names a window
 * before the first model response of a turn.
 * For OpenCode, the model is the confirmed ACP selector and the two values
 * come from `usage_update.used` and `usage_update.size` of the same session.
 * A value the CLI did not report is `null`; none is derived from summed
 * tokens. The attempt, workspace and time come from the authenticated
 * binding and the event, never from this text.
 */
export const runnerSessionReadingSchema = z
  .object({
    session: z
      .object({
        model: z.string().regex(MODEL_NAME),
        context: z
          .object({
            used: tokenCount.nullable(),
            limit: tokenCount.positive().nullable(),
            source: z.enum(RUNNER_CONTEXT_SOURCES),
          })
          .strict()
          .nullable(),
      })
      .strict(),
  })
  .strict();

/** A validated session reading of a native runner job. */
export type RunnerSessionReading = z.infer<
  typeof runnerSessionReadingSchema
>["session"];

/**
 * Reads a session reading from the text of a `usage` event.
 * @returns The reading; `undefined` for token counters and any other text,
 * which keep their own path; `null` for a reading that breaks the contract,
 * which is dropped instead of stalling the receipt of its batch.
 */
export function readRunnerSessionReading(
  text: string,
): RunnerSessionReading | null | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || !("session" in parsed))
    return undefined;
  const reading = runnerSessionReadingSchema.safeParse(parsed);
  return reading.success ? reading.data.session : null;
}
