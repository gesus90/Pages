import { z } from "zod";

const identifier = z.string().regex(/^[A-Za-z0-9._:-]{1,256}$/u);

/** Strict private ACP requests emitted by the Pica Codex adapter. */
export const PICA_CODEX_REQUEST = {
  catalog: z.object({}).strict(),
  thread: z.object({ threadId: identifier }).strict(),
  policyThread: z
    .object({
      threadId: identifier,
      context: z
        .string()
        .regex(/^[a-f0-9]{64}$/u)
        .optional(),
    })
    .strict(),
  turn: z.object({ threadId: identifier, turnId: identifier }).strict(),
  prepareCancel: z
    .object({
      threadId: identifier,
      nonce: z.string().regex(/^[a-f0-9]{64}$/u),
    })
    .strict(),
  ready: z
    .object({
      requestId: identifier,
      threadId: identifier,
      turnId: identifier,
      nonce: z.string().regex(/^[a-f0-9]{64}$/u),
      operationId: z.string().uuid(),
      sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      context: z.string().regex(/^[a-f0-9]{64}$/u),
      catalog: z
        .array(
          z
            .object({
              type: z.literal("function"),
              name: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/u),
              description: z.string().min(1).max(10_000),
              inputSchema: z.record(z.string(), z.unknown()),
            })
            .strict(),
        )
        .min(1)
        .max(512),
    })
    .strict(),
  call: z
    .object({
      operationId: z.string().uuid().optional(),
      nonce: z
        .string()
        .regex(/^[a-f0-9]{64}$/u)
        .optional(),
      sequence: z
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .optional(),
      threadId: identifier,
      turnId: identifier,
      callId: identifier,
      tool: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/u),
      arguments: z.record(z.string(), z.unknown()),
    })
    .strict(),
  chunk: z
    .object({
      operationId: z.string().uuid().optional(),
      nonce: z
        .string()
        .regex(/^[a-f0-9]{64}$/u)
        .optional(),
      sequence: z
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .optional(),
      threadId: identifier,
      turnId: identifier,
      callId: identifier,
      receipt: z.string().uuid(),
      image: z.number().int().min(0).max(3),
      offset: z.number().int().min(0).max(8_000_000),
    })
    .strict(),
} as const;

/** Private request names, shared by Pages and the generated adapter glue. */
export const PICA_CODEX_METHOD = {
  catalog: "_pages/pica/catalog",
  bindThread: "_pages/pica/bind_thread",
  bindTurn: "_pages/pica/bind_turn",
  prepare: "_pages/pica/prepare",
  ready: "_pages/pica/ready",
  revoke: "_pages/pica/revoke",
  cancelPrepare: "_pages/pica/cancel_prepare",
  endTurn: "_pages/pica/end_turn",
  closeThread: "_pages/pica/close_thread",
  dispatch: "_pages/pica/dispatch",
  chunk: "_pages/pica/chunk",
} as const;
