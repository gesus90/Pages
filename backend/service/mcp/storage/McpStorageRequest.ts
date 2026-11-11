import { z } from "zod";

/** Metadata of one Storage MCP call; byte content travels separately. */
const requestSchema = z.object({
  ref: z.string().trim().max(200).default(""),
  path: z.string().trim().max(4096).default(""),
  parentRef: z.string().trim().max(200).default("root"),
  targetParentRef: z.string().trim().max(200).nullable().default(null),
  folderRef: z.string().trim().max(200).nullable().default(null),
  name: z.string().trim().max(255).default(""),
  query: z.string().trim().max(200).default(""),
  format: z.string().trim().max(200).nullable().default(null),
  mimeType: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default("application/octet-stream"),
  onConflict: z.enum(["fail", "keep_both", "overwrite"]).default("fail"),
  confirmation: z.string().max(200).nullable().default(null),
  action: z
    .enum(["delete", "delete_permanently", "update", "overwrite"])
    .optional(),
  pageSize: z
    .union([
      z.number(),
      z
        .string()
        .regex(/^[0-9]+$/u)
        .transform(Number),
    ])
    .pipe(z.number().int().min(1).max(1000))
    .nullable()
    .default(null),
  pageToken: z.string().min(1).max(2048).nullable().default(null),
  trash: z
    .union([z.boolean(), z.enum(["1", "0", "true", "false"])])
    .default(false),
});

/** Validated parameters shared by the Storage MCP operations. */
export type McpStorageInput = z.infer<typeof requestSchema>;

/**
 * Validates metadata and translates cursor, limit and folder aliases.
 *
 * @param input - Untrusted JSON or query fields.
 * @returns Validated metadata, or `null` for invalid fields.
 */
export function readMcpStorageInput(
  input: Readonly<Record<string, unknown>>,
): McpStorageInput | null {
  const parsed = requestSchema.safeParse({
    ...input,
    pageToken: input.pageToken ?? input.cursor,
    pageSize: input.pageSize ?? input.limit,
    folderRef: input.folderRef ?? input.folder,
  });
  return parsed.success ? parsed.data : null;
}
