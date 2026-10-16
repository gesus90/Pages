import { readAgentObject } from "@/backend/agents/AgentPayload";
import {
  readChatJob,
  readChatJobUpdate,
  readChatSteer,
} from "@/definition/ChatJobReader";

import { readChatReply } from "./chat-client";

import type { ChatSendResult } from "@/definition/Chat";
import type { ChatJobUpdate } from "@/definition/ChatJob";

/**
 * Reads the answer to a sent message: an answer, a started job or a steer.
 *
 * @param result - The JSON of the `send` intent.
 * @returns What the server did with the message.
 */
export function readChatSendResult(
  result: Readonly<Record<string, unknown>>,
): ChatSendResult {
  if (result.job !== undefined) {
    const start = readAgentObject(result.job);
    if (typeof start.messageId !== "string")
      throw new TypeError("Invalid job start");
    return {
      kind: "job",
      job: { job: readChatJob(start.job), messageId: start.messageId },
    };
  }
  if (result.steer !== undefined)
    return { kind: "steer", steer: readChatSteer(result.steer) };
  return { kind: "reply", reply: readChatReply(result.reply) };
}

/** Reads a job with its journal after the cursor, or `null` when the conversation has none. */
export function readChatJobResult(
  result: Readonly<Record<string, unknown>>,
): ChatJobUpdate | null {
  return result.update === null || result.update === undefined
    ? null
    : readChatJobUpdate(result.update);
}
