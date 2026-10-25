import { z } from "zod";

/** Safe preparation failures that can be shown without provider or file contents. */
export const runnerResourceErrorSchema = z.enum([
  "parameter_asset_unavailable",
  "parameter_assets_too_large",
  "parameter_asset_type_unsupported",
  "parameter_asset_reference_unsupported",
  "parameter_ticket_changed",
  "parameter_ticket_unavailable",
  "parameter_reference_unavailable",
  "plan_mcp_unavailable",
  "plan_context_changed",
]);

/** Ephemeral requests travel over the already authenticated runner channel, outside its durable journal. */
export const runnerPagesRequestSchema = z
  .object({
    version: z.literal(1),
    type: z.literal("pages-request"),
    requestId: z.string().uuid(),
    jobId: z.string().uuid(),
    request: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("prepare") }).strict(),
      z.object({ kind: z.literal("lease") }).strict(),
      z
        .object({
          kind: z.literal("asset"),
          index: z.number().int().min(0).max(63),
          offset: z
            .number()
            .int()
            .min(0)
            .max(10 * 1024 * 1024),
        })
        .strict(),
      z.object({ kind: z.literal("list") }).strict(),
      z
        .object({
          kind: z.literal("call"),
          name: z.string().min(1).max(100),
          arguments: z.record(z.string(), z.unknown()),
        })
        .strict(),
    ]),
  })
  .strict();
export type RunnerPagesRequest = z.infer<typeof runnerPagesRequestSchema>;
