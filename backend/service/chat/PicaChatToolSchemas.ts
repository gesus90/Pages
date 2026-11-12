import { z } from "zod";

import { AGENT_CHAT_WAIT_MAXIMUM_SECONDS } from "@/definition/Conversation";

const identifier = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[\w-]+$/u);

/** The tool with which an agent lists its chats (PAGE-311). */
export const PICA_CHATS_LIST_TOOL = "chats_list";

/** The tool with which an agent reads a chat it takes part in (PAGE-311). */
export const PICA_CHAT_READ_TOOL = "chat_read";

/** The tool with which an agent sends a message and may wait for the reply (PAGE-311). */
export const PICA_CHAT_SEND_TOOL = "chat_send";

/** How long a reply is awaited while the agent names no limit, in seconds. */
export const PICA_CHAT_WAIT_DEFAULT_SECONDS = 50;

/** The input of `chats_list`. */
export const PICA_CHATS_LIST_SCHEMA = z
  .object({ cursor: z.string().max(4000).optional() })
  .strict();

/** The input of `chat_read`. */
export const PICA_CHAT_READ_SCHEMA = z
  .object({ chatId: identifier, beforeMessageId: identifier.optional() })
  .strict();

/** The input of `chat_send`: a chat or a target, the text, and the wish to wait for the reply. */
export const PICA_CHAT_SEND_SCHEMA = z
  .object({
    chatId: identifier.optional(),
    target: z
      .object({ type: z.enum(["person", "agent", "group"]), id: identifier })
      .strict()
      .optional(),
    text: z.string().trim().min(1).max(16_000),
    waitForReply: z.boolean().optional(),
    timeoutSeconds: z
      .number()
      .int()
      .min(1)
      .max(AGENT_CHAT_WAIT_MAXIMUM_SECONDS)
      .optional(),
  })
  .strict();

/** What the answer of the target search holds, as far as the check of a target needs it. */
export const PICA_TARGET_SEARCH_RESULT = z
  .object({
    targets: z.array(
      z.object({ targetType: z.string(), id: z.string() }).passthrough(),
    ),
    nextCursor: z.string().nullable(),
  })
  .passthrough();
