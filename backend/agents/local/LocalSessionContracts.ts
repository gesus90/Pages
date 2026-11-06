import { z } from "zod";

import { AGENT_ERROR_MESSAGES } from "@/backend/error/AgentErrors";
import { readOwnedNamespace } from "@/definition/AcpNamespace";

import type { CliSessionMcp } from "@/backend/agents/cli/CliSessionPlans";

const identifier = z.uuid();
const text = z.string().max(200_000);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const reported = z.object({
  value: z.string().nullable(),
  source: z
    .enum(["plan", "acp_config_option", "acp_usage_report", "adapter_selector"])
    .nullable(),
  reportedAt: z.string().nullable(),
});

/**
 * An immutable native turn request; it contains no provider credential and no
 * plan bridge bearer. The bearer reaches the owner only through the `bearer`
 * command of the private socket and stays in its memory.
 */
export const localLaunchSchema = z.object({
  runId: identifier,
  stepId: identifier,
  sessionScopeId: z.string().max(200),
  attemptId: identifier,
  turnId: identifier,
  isInstruction: z.boolean(),
  instanceId: identifier,
  userId: identifier,
  prompt: text,
  instruction: text,
  resumeSessionId: z.string().max(200).nullable(),
  timeoutMinutes: count,
  mcp: z
    .object({
      url: z.string(),
      tools: z.array(z.string()).nullable(),
    })
    .nullable(),
});

/** Startup authority stays in private instance storage, never in a command argument. */
export const localOwnerManifestSchema = z.object({
  version: z.literal(1),
  instanceKey: z.string().regex(/^[a-f0-9]{64}$/u),
  capability: z.string().regex(/^[a-f0-9]{64}$/u),
  configPath: z.string(),
  directory: z.string(),
  unit: z.string().regex(/^pages-local-[a-f0-9-]{36}\.service$/u),
  launch: localLaunchSchema,
});

/** The complete service-manager identity captured by the owner itself. */
export const localOwnerProofSchema = z.object({
  instanceKey: z.string(),
  instanceId: identifier,
  runId: identifier,
  stepId: identifier,
  attemptId: identifier,
  unit: z.string(),
  invocationId: z.string().regex(/^[a-f0-9]{32}$/u),
  boot: identifier,
  uid: count,
  pid: z.number().int().positive(),
  start: count,
  cgroup: z.string().min(1),
  arguments: z.array(z.string()).max(16),
});

const attempt = z.object({
  key: z.object({
    planId: identifier,
    runId: identifier,
    stepId: identifier,
    attemptId: identifier,
  }),
  userId: identifier,
  provider: z.enum(["codex_cli", "claude_code", "opencode", "antigravity"]),
  instanceId: identifier,
  groupId: z.string().nullable(),
  state: z.enum([
    "starting",
    "running",
    "waiting_for_input",
    "idle",
    "waiting_for_capacity",
    "recovering",
    "ended",
    "failed",
    "cancelled",
  ]),
  context: z.object({
    contextUsed: count.nullable(),
    contextLimit: count.nullable(),
    percent: z.number().nullable(),
    source: z.literal("acp_usage_update").nullable(),
    reportedAt: z.string().nullable(),
  }),
  confirmedModel: reported,
  confirmedReasoning: reported,
  workspace: z
    .object({
      directory: z.string(),
      checkedAt: z.string(),
      git: z.discriminatedUnion("state", [
        z.object({ state: z.literal("branch"), branch: z.string() }),
        z.object({ state: z.literal("detached"), commit: z.string() }),
        z.object({ state: z.literal("no_repository") }),
        z.object({ state: z.literal("unreadable") }),
      ]),
    })
    .nullable(),
  updatedAt: z.string(),
});
const event = z.object({
  turn: count.nullable(),
  kind: z.enum([
    "user_instruction",
    "repair_instruction",
    "agent_message",
    "tool_started",
    "tool_completed",
    "tool_failed",
    "plan",
    "status",
    "error",
    "recovery",
    "usage",
  ]),
  text,
  isTruncated: z.boolean(),
  createdAt: z.string(),
  dedupeKey: z.string().nullable(),
});
const usage = z.object({
  attemptId: identifier,
  turn: count,
  provider: z.enum(["codex_cli", "claude_code", "opencode", "antigravity"]),
  model: z.string().nullable(),
  inputTokens: count.nullable(),
  outputTokens: count.nullable(),
  cacheReadTokens: count.nullable(),
  cacheWriteTokens: count.nullable(),
  totalTokens: count.nullable(),
  inputIncludesCache: z.boolean().nullable(),
  isPartial: z.boolean(),
  reportedAt: z.string(),
});
const errorCode = z
  .string()
  .refine((code) => Object.hasOwn(AGENT_ERROR_MESSAGES, code))
  .transform((code) => {
    const found = Object.keys(AGENT_ERROR_MESSAGES).find(
      (candidate) => candidate === code,
    );
    if (!found || !isAgentErrorCode(found))
      throw new Error("Invalid agent error code");
    return found;
  });

function isAgentErrorCode(
  code: string,
): code is keyof typeof AGENT_ERROR_MESSAGES {
  return Object.hasOwn(AGENT_ERROR_MESSAGES, code);
}

/** Native result, not an inferred success or a substituted provider reply. */
export const localTurnSchema = z.object({
  output: text,
  sessionId: z.string().nullable(),
  failure: z.enum(["timeout", "cancelled", "failed", "incomplete"]).nullable(),
  errorCode: errorCode.nullable(),
  endedAt: z.string(),
  permissionDenials: count,
  effective: z.record(z.string(), z.string()),
  events: z.array(z.string()).max(1000),
  providerFailure: z
    .object({
      code: z.enum([
        "provider_unreachable",
        "provider_unavailable",
        "provider_rate_limited",
        "provider_quota_exhausted",
      ]),
      resetAt: z.string().nullable(),
    })
    .optional(),
});

/** Native closeout always retains the actual process cleanup result. */
export const localClosedSchema = z.object({
  exit: z
    .object({ code: z.number().nullable(), signal: z.string().nullable() })
    .nullable(),
  endedAt: z.string(),
  leftovers: count,
  isConfirmed: z.boolean(),
  containment: z.literal("pid_namespace").optional(),
});

/** File-first mutations and milestones, ordered together for one native owner. */
export const localMutationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("position"),
    turns: count,
    attemptId: identifier,
    turnId: identifier,
  }),
  z.object({
    kind: z.literal("frame"),
    attemptId: identifier,
    channel: z.enum(["announced", "update", "prompted", "closed"]),
    body: z.string().max(8 * 1024 * 1024),
  }),
  z.object({ kind: z.literal("attempt"), attempt }),
  z.object({
    kind: z.literal("events"),
    attemptId: identifier,
    events: z.array(event).max(200),
    retain: count,
  }),
  z.object({ kind: z.literal("usage"), usage }),
  z.object({
    kind: z.literal("started"),
    details: z.object({
      mode: z.enum(["one_shot", "interactive"]),
      processId: count.nullable(),
      startedAt: z.string(),
      arguments: z.array(z.string()),
      unattended: z.string(),
      namespace: z.unknown().transform(readOwnedNamespace).optional(),
    }),
  }),
  z.object({ kind: z.literal("identified"), sessionId: z.string() }),
  z.object({
    kind: z.literal("capabilities"),
    capabilities: z.object({
      canResume: z.boolean(),
      canLoad: z.boolean(),
      adapter: z.string(),
    }),
  }),
  z.object({
    kind: z.literal("progressed"),
    events: z.array(z.string()).max(1000),
  }),
  z.object({
    kind: z.literal("activity"),
    activity: z.object({
      reportedAt: z.string(),
      titles: z.array(z.string()).max(1000),
    }),
  }),
  z.object({
    kind: z.literal("turn"),
    attemptId: identifier,
    turnId: identifier,
    result: localTurnSchema,
  }),
  z.object({ kind: z.literal("closed"), result: localClosedSchema }),
]);

/** A journal reference is small; the immutable body uses the PAGE-223 file store. */
export const localJournalRecordSchema = z.object({
  sequence: count,
  previousDigest: z.string(),
  payload: z.string().max(2048),
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
});

/** Authenticated IPC commands are bounded independently of journal contents. */
export const localCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("attach"), token: identifier }),
  z.object({ kind: z.literal("bearer"), token: z.string().min(43).max(128) }),
  z.object({ kind: z.literal("read"), after: count, limit: count.max(200) }),
  z.object({ kind: z.literal("ack"), sequence: count, digest: z.string() }),
  z.object({ kind: z.literal("cancel") }),
  z.object({ kind: z.literal("close") }),
  z.object({ kind: z.literal("release") }),
  z.object({ kind: z.literal("next"), launch: localLaunchSchema }),
  z.object({
    kind: z.literal("steer"),
    prompt: z.string().max(200_000),
    commandId: identifier,
  }),
]);

export type LocalSessionLaunch = z.infer<typeof localLaunchSchema>;

/**
 * The Pages tool access of a restored native session as the plan engine sees it.
 *
 * @param launch - The stored turn request of the session.
 * @returns The address and tools without a bearer: the bearer lives only in
 * the memory of the owner, and the engine never needs it again.
 */
export function restoredLocalMcp(
  launch: LocalSessionLaunch,
): CliSessionMcp | null {
  return launch.mcp === null ? null : { ...launch.mcp, token: "" };
}
export type LocalOwnerManifest = z.infer<typeof localOwnerManifestSchema>;
export type LocalOwnerProof = z.infer<typeof localOwnerProofSchema>;
export type LocalSessionMutation = z.infer<typeof localMutationSchema>;
export type LocalJournalRecord = z.infer<typeof localJournalRecordSchema>;
export type LocalSessionCommand = z.infer<typeof localCommandSchema>;
