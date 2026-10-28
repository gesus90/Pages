import { z } from "zod";

import type { AgentProviderId } from "./AgentConnection";

/** Existing remote command limit, checked before admission as well as at the runner boundary. */
export const MAX_RUNNER_PROMPT_CHARACTERS = 100000;

/** The command line tools a runner drives, with the provider of their plan nodes. */
export const RUNNER_TOOL_PROVIDERS = {
  codex: "codex_cli",
  claude: "claude_code",
  opencode: "opencode",
} as const;

/** One command line tool a runner drives. */
export type RunnerCliTool = keyof typeof RUNNER_TOOL_PROVIDERS;

/** The runner tool of a node provider; `null` for an API provider. */
export function runnerToolFor(provider: AgentProviderId): RunnerCliTool | null {
  for (const [tool, owner] of Object.entries(RUNNER_TOOL_PROVIDERS))
    if (owner === provider && isRunnerCliTool(tool)) return tool;
  return null;
}

function isRunnerCliTool(tool: string): tool is RunnerCliTool {
  return Object.hasOwn(RUNNER_TOOL_PROVIDERS, tool);
}

/** A catalog selection is bound to one authorized workspace and provider revision. */
export const runnerModelRouteSchema = z
  .object({
    connectionId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    catalogRevision: z.string().min(1).max(100),
    /** Absent selects OpenRouter; CLI routes use only the remote person's login or the host's own providers. */
    tool: z.enum(["codex", "claude", "opencode"]).optional(),
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
    /** Adopted plan revision; revision itself retains the run's original binding. */
    sourceRevision: z.number().int().positive().optional(),
    workspace: z.string().startsWith("/").max(4096),
    timeoutSeconds: z.number().int().min(0).max(86400),
    outputBytes: z.number().int().min(1).max(65536),
    input: z.string().max(1048576),
    hasOutput: z.boolean().optional(),
    /** Runner 1.13.0 returns only the final CLI payload, without a provenance prefix. */
    resultPayloadVersion: z.literal(1).optional(),
    /** Requires Runner 1.6.0; credentials and file contents never belong to a durable command. */
    pagesAccess: z.literal(1).optional(),
    program: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("cli"),
          route: runnerModelRouteSchema,
          model: z.string().min(1).max(200),
          reasoningEffort: z.string().max(40).nullable(),
          prompt: z.string().max(MAX_RUNNER_PROMPT_CHARACTERS),
          access: z.enum(["read_only", "yolo"]),
        })
        .strict(),
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
          prompt: z.string().max(MAX_RUNNER_PROMPT_CHARACTERS),
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
