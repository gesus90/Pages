import { z } from "zod";

const identifier = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[\w-]+$/u);

/** Deliberately narrow native inputs; identity and execution options are never model arguments. */
export const PICA_TOOL_SCHEMAS = {
  tickets_search: z
    .object({
      projectId: identifier,
      text: z.string().max(500).optional(),
      limit: z.number().int().min(1).max(20).optional(),
      cursor: z.string().max(4000).optional(),
    })
    .strict(),
  tickets_read: z.object({ ticketId: identifier }).strict(),
  projects_read: z.object({ projectId: identifier }).strict(),
  tickets_set_title: z
    .object({
      ticketId: identifier,
      expectedTitle: z.string().max(500),
      title: z.string().trim().min(1).max(500),
    })
    .strict(),
  tickets_set_status: z
    .object({
      ticketId: identifier,
      expectedStatusId: identifier,
      statusId: identifier,
    })
    .strict(),
} as const;

/** Bounded, credential-redacted JSON from existing services; no human-only receipts. */
export const PICA_TOOL_OUTCOME = z
  .object({
    ok: z.boolean(),
    result: z.string().max(20_000).nullable(),
    error: z.string().max(100).nullable(),
  })
  .strict();

export type PicaToolOutcome = z.infer<typeof PICA_TOOL_OUTCOME>;
export type PicaWriteTool = "tickets_set_title" | "tickets_set_status";

/** Parses only the two supported writes, including their concurrency preconditions. */
export function readPicaWrite(
  tool: PicaWriteTool,
  input: unknown,
): Record<string, string> | null {
  const parsed = PICA_TOOL_SCHEMAS[tool].safeParse(input);
  return parsed.success ? parsed.data : null;
}
