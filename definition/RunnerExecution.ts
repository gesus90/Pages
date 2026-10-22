import { z } from "zod";

/** A catalog selection is bound to one authorized workspace and provider revision. */
export const runnerModelRouteSchema = z
  .object({
    connectionId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    catalogRevision: z.string().min(1).max(100),
  })
  .strict();
export type RunnerModelRoute = z.infer<typeof runnerModelRouteSchema>;

/** Runner-owned interpreter identities include the checked binary's content digest. */
export const runnerInterpreterSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().max(200),
    path: z.string().startsWith("/").max(4096),
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
    version: z.string().max(200),
  })
  .strict();
export type RunnerInterpreter = z.infer<typeof runnerInterpreterSchema>;

/** Frozen command material is private to Pages and the authenticated runner channel. */
export const runnerExecutionSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().positive(),
    workspace: z.string().startsWith("/").max(4096),
    timeoutSeconds: z.number().int().min(1).max(86400),
    outputBytes: z.number().int().min(1).max(65536),
    input: z.string().max(1048576),
    hasOutput: z.boolean().optional(),
    program: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("script"),
          interpreter: runnerInterpreterSchema,
          source: z.string().max(100000),
        })
        .strict(),
      z
        .object({
          kind: z.literal("model"),
          route: runnerModelRouteSchema,
          model: z.string().max(200),
          prompt: z.string().max(100000),
        })
        .strict(),
    ]),
  })
  .strict();
export type RunnerExecution = z.infer<typeof runnerExecutionSchema>;

/** Launch identity survives transport loss; an absent exit record is never inferred as success. */
export const runnerLaunchSchema = z
  .object({
    id: z.string().uuid(),
    processId: z.number().int().positive(),
    identity: z.string().max(100),
  })
  .strict();
