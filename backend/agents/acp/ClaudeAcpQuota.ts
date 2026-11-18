import { z } from "zod";

import { readAgentObject } from "@/backend/agents/AgentPayload";
import { providerResetTimestamp } from "@/backend/agents/providers/ProviderReset";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  isClaudeQuotaWindowKind,
  readClaudePlan,
} from "@/definition/ClaudeQuota";

import type { client as acpClient } from "@agentclientprotocol/sdk";
import type { AcpSessionContext } from "./AcpSessionContracts";
import type { ClaudePlan, ClaudeQuotaWindow } from "@/definition/ClaudeQuota";

/** The key under which the Claude adapter forwards a rate limit event of the CLI. */
const RATE_LIMIT_KEY = "_claude/rateLimit";

/** The extension notification with which the Claude adapter pushes its sign-in. */
const AUTH_STATUS_METHOD = "_auth/status_update";

/** Sign-in kinds that pay with something other than a claude.ai subscription. */
const NON_SUBSCRIPTION_KINDS = new Set(["api_key", "external", "gateway"]);

const authStatusEnvelope = z.object({
  authStatus: z.object({
    kind: z.string().max(40),
    account: z.object({ plan: z.unknown() }).partial().optional(),
  }),
});

/**
 * Receives the subscription figures one Claude session reports for its connection.
 * @remarks
 * Recording never fails the session: an implementation handles its own
 * errors, because the figures are only shown, never decided upon.
 */
export interface ClaudeQuotaSink {
  /** Stores a usage window as Claude reported it. */
  recordWindow(window: ClaudeQuotaWindow): void;
  /** Stores the subscription; `null` when it is no known claude.ai plan. */
  recordPlan(plan: ClaudePlan | null): void;
}

/**
 * Reads the usage window of a rate limit event the Claude adapter forwards.
 * @param meta - The `_meta` of a session update.
 * @returns The window, or `null` when the update carries none, names another
 * window or reports no usage and no rejection.
 * @remarks
 * Claude Code reports `utilization` as a fraction of 1 and `resetsAt` in
 * epoch seconds; one event names one window. A rejected window without a
 * figure is used up.
 */
export function readClaudeQuotaWindow(meta: unknown): ClaudeQuotaWindow | null {
  const root = readAgentObject(meta);
  if (!Object.hasOwn(root, RATE_LIMIT_KEY)) return null;
  const limit = readAgentObject(root[RATE_LIMIT_KEY]);
  const kind = limit.rateLimitType;
  const resetsAt = providerResetTimestamp(limit.resetsAt);
  if (!isClaudeQuotaWindowKind(kind) || resetsAt === null) return null;
  const { utilization } = limit;
  let usedFraction: number | null = null;
  if (typeof utilization === "number" && Number.isFinite(utilization))
    usedFraction = Math.min(1, Math.max(0, utilization));
  else if (limit.status === "rejected") usedFraction = 1;
  if (usedFraction === null) return null;
  // Two decimals keep the share exact enough without float residue.
  const usedPercentage = Math.round(usedFraction * 10_000) / 100;
  return { kind, usedPercentage, resetsAt };
}

/**
 * Reads the subscription from a sign-in the Claude adapter pushes.
 * @param params - The parameters of `_auth/status_update`.
 * @returns The plan, `null` for a sign-in without a known plan, and
 * `undefined` when the notification says nothing about the plan, such as
 * a signed-out CLI.
 */
export function readClaudeAuthPlan(
  params: unknown,
): ClaudePlan | null | undefined {
  const parsed = authStatusEnvelope.safeParse(params);
  if (!parsed.success) return undefined;
  const { kind, account } = parsed.data.authStatus;
  if (kind === "account") return readClaudePlan(account?.plan);
  return NON_SUBSCRIPTION_KINDS.has(kind) ? null : undefined;
}

/**
 * Follows the sign-in a Claude adapter pushes and stores its subscription.
 * @param client - The ACP client before it connects.
 * @param context - The session; only Claude sessions with a sink listen.
 * @remarks
 * The notification is no session update, so it holds no read of the
 * adapter's output back and acknowledges nothing.
 */
export function registerClaudeQuota(
  client: ReturnType<typeof acpClient>,
  context: Pick<AcpSessionContext, "driver" | "claudeQuota">,
): void {
  const sink = context.claudeQuota;
  if (context.driver.provider !== "claude_code" || !sink) return;
  client.onNotification(AUTH_STATUS_METHOD, z.unknown(), ({ params }) => {
    try {
      const plan = readClaudeAuthPlan(params);
      if (plan !== undefined) sink.recordPlan(plan);
    } catch (error: unknown) {
      logCaughtError("ClaudeAcpQuota", error);
    }
  });
}
