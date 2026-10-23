import { z } from "zod";

/** A repository name, never an arbitrary URL, path or Git option. */
export const runnerGitHubRepositorySchema = z
  .string()
  .max(240)
  .regex(/^[a-z\d-]+\/[a-z\d_][a-z\d_.-]*$/iu);

/** The runner receives repository metadata only; its private key stays on that host. */
export const runnerGitHubAccessCommandSchema = z
  .object({
    version: z.literal(1),
    type: z.literal("github-access"),
    requestId: z.string().uuid(),
    repository: runnerGitHubRepositorySchema,
  })
  .strict();
export type RunnerGitHubAccessCommand = z.infer<
  typeof runnerGitHubAccessCommandSchema
>;

/** Fixed diagnostics replace raw Git/SSH output, including account and key metadata. */
export const runnerGitHubProbeSchema = z
  .object({
    allowed: z.boolean().nullable(),
    reason: z.enum(["verified", "denied", "unavailable"]),
  })
  .strict()
  .refine((probe) => {
    if (probe.allowed === null) return probe.reason === "unavailable";
    return probe.reason === (probe.allowed ? "verified" : "denied");
  });
export type RunnerGitHubProbe = z.infer<typeof runnerGitHubProbeSchema>;

/** Both probes are separately correlated with the requested repository. */
export const runnerGitHubAccessReplySchema = z
  .object({
    version: z.literal(1),
    type: z.literal("github-access-result"),
    requestId: z.string().uuid(),
    repository: runnerGitHubRepositorySchema,
    read: runnerGitHubProbeSchema,
    write: runnerGitHubProbeSchema,
  })
  .strict();
export type RunnerGitHubAccessReply = z.infer<
  typeof runnerGitHubAccessReplySchema
>;
