import { z } from "zod";

const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/**
 * The usage of one model step a runner job read from OpenCode's own session
 * database.
 * @remarks
 * It travels as a `usage` event beside the token counters, but as an object
 * of its own: `id` and `sessionId` name the native assistant message of the
 * step and its native session, which may be a sub-session of the job's
 * session. The counts are the ones OpenCode measured for that step: the
 * input without the cache reads, the output without the reasoning. `costUsd`
 * is the cost OpenCode calculated for the step. A value the step did not
 * report is `null`, never 0. The attempt and the time come from the
 * authenticated binding and the event, never from this text.
 */
export const runnerOpenCodeMessageSchema = z
  .object({
    openCodeMessage: z
      .object({
        id: z.string().min(1).max(200),
        sessionId: z.string().min(1).max(200),
        model: z.string().min(1).max(301).nullable(),
        inputTokens: tokenCount.nullable(),
        outputTokens: tokenCount.nullable(),
        reasoningTokens: tokenCount.nullable(),
        cacheReadTokens: tokenCount.nullable(),
        cacheWriteTokens: tokenCount.nullable(),
        costUsd: z.number().finite().nonnegative().nullable(),
      })
      .strict(),
  })
  .strict();

/** A validated step usage of an OpenCode runner job. */
export type RunnerOpenCodeMessage = z.infer<
  typeof runnerOpenCodeMessageSchema
>["openCodeMessage"];

/**
 * Reads the usage of an OpenCode model step from the text of a `usage` event.
 * @param text - The text of the event.
 * @returns The usage; `undefined` for token counters and any other text,
 * which keep their own path; `null` for a usage that breaks the contract,
 * which is dropped instead of stalling the receipt of its batch.
 */
export function readRunnerOpenCodeMessage(
  text: string,
): RunnerOpenCodeMessage | null | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("openCodeMessage" in parsed)
  )
    return undefined;
  const reading = runnerOpenCodeMessageSchema.safeParse(parsed);
  return reading.success ? reading.data.openCodeMessage : null;
}
