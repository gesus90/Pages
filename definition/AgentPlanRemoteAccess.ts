import { z } from "zod";

/** Public resource evidence contains identities and metadata, never file contents or credentials. */
export const planRemoteResourceSchema = z.object({
  parameter: z.string().max(64),
  type: z.enum(["ticket", "wiki", "workspace"]),
  id: z.string().max(100),
  name: z.string().max(300),
  version: z.string().max(100),
});
export type PlanRemoteResource = z.infer<typeof planRemoteResourceSchema>;

/** Files are retained outside the repository only until the remote worker closes. */
export const planRemoteFileSchema = z.object({
  parameter: z.string().max(64),
  name: z.string().max(300),
  type: z.string().min(1).max(100),
  asset: z
    .object({
      source: z.enum(["ticket", "wiki", "agent"]),
      id: z.string().max(100),
      link: z.string().max(400),
    })
    .optional(),
  outcome: z.enum(["input", "uploaded", "staged"]).optional(),
  representation: z
    .enum(["original", "source", "text-extract", "model-image"])
    .optional(),
  modelContent: z.string().max(100).optional(),
  modelSize: z
    .number()
    .int()
    .nonnegative()
    .max(2 * 1024 * 1024)
    .optional(),
  isTruncated: z.boolean().optional(),
  size: z
    .number()
    .int()
    .nonnegative()
    .max(10 * 1024 * 1024),
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
});
export type PlanRemoteFile = z.infer<typeof planRemoteFileSchema>;

/** Pages records only the registered tool, a bounded resource reference and the outcome. */
export const planRemoteAccessSchema = z.object({
  files: z.array(planRemoteFileSchema).max(128),
  pages: z.enum(["active", "closed", "unavailable"]),
  events: z
    .array(
      z.object({
        at: z.string().datetime(),
        tool: z.string().max(100),
        target: z.string().max(100).nullable(),
        result: z.enum(["ok", "denied", "failed"]),
      }),
    )
    .max(1000),
});
export type PlanRemoteAccess = z.infer<typeof planRemoteAccessSchema>;

/** Safe file-specific diagnosis, usable in validation and persisted run details. */
export const assetFailureSchema = z.object({
  id: z.string().max(100),
  name: z.string().max(300),
  cause: z.string().max(100),
});
