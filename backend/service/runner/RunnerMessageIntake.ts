import { logEvent } from "@/backend/logging/Logger";

import { runnerMessageSchema } from "@/definition/RunnerProtocol";

import { runnerSchemaIssues } from "./RunnerSchemaDiagnosis";

import type { RunnerMessage } from "@/definition/RunnerProtocol";

/**
 * Validates one inbound runner packet and logs each schema rejection before throwing.
 *
 * @remarks
 * Only the safe schema facts of each issue reach the log; the rejected input is never echoed.
 *
 * @param connectionId - The SSH connection that sent the packet.
 * @param input - The unparsed packet.
 * @returns The validated protocol message.
 * @throws The Zod error of a rejected packet.
 */
export function parseRunnerMessage(
  connectionId: string,
  input: unknown,
): RunnerMessage {
  const parsed = runnerMessageSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of runnerSchemaIssues(parsed.error))
      logEvent({
        level: "error",
        event: "runner.protocol.schema_rejected",
        component: "RunnerService",
        message:
          "Runner packet rejected by the protocol schema; inspect field, type and paired source versions",
        metadata: { connectionId, ...issue },
      });
    throw parsed.error;
  }
  return parsed.data;
}
