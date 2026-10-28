import { z } from "zod";

import { AgentError, isAgentErrorCode } from "@/backend/error/AgentErrors";
import { AGENT_PLAN_ISSUE_PROBLEMS } from "@/definition/AgentPlanOperations";

import type { AgentPlanStartRejection } from "@/definition/AgentPlanStartRejection";

const text = z.string().min(1).max(4096);
const target = z.strictObject({
  kind: z.enum(["local", "remote"]),
  workspaceId: text,
  path: text,
  connectionName: text.nullable(),
  workspaceName: text.nullable(),
});
const conflict = z.strictObject({
  kind: z.enum(["parallel_writers", "reserved"]),
  targets: z.array(target),
  nodes: z.array(z.strictObject({ id: text, name: text })),
});
/** Only node, port and the fixed graph reason are retained from a start finding. */
export const planStartRejectionIssuesSchema = z
  .array(
    z.strictObject({
      nodeId: z.string().max(4096).nullable(),
      port: z.string().max(4096).nullable(),
      problem: z.enum(AGENT_PLAN_ISSUE_PROBLEMS),
    }),
  )
  .max(50);
const rejection = z.strictObject({
  id: text,
  createdAt: text,
  action: z.enum(["play", "save_and_play"]),
  planRevision: z.number().int().positive(),
  isSavedRevision: z.boolean(),
  error: z.string().refine(isAgentErrorCode),
  issues: planStartRejectionIssuesSchema.optional(),
  issueDetailsFiltered: z.boolean().optional(),
  conflict: conflict.nullable(),
  reservation: z.enum(["not_requested", "held", "unknown"]),
  targetResolution: z.enum([
    "local_resolved",
    "remote_registered",
    "mixed",
    "unknown",
  ]),
});

/** Reads a stored or transported refusal without trusting its contents. */
export function readPlanStartRejection(
  input: unknown,
): AgentPlanStartRejection {
  const parsed = rejection.safeParse(input);
  if (!parsed.success) throw new AgentError("plan_invalid");
  return parsed.data;
}
