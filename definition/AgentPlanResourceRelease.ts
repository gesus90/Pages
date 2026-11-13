import { z } from "zod";

/** Process evidence retained with an explicit forced release, including uncertain cleanup. */
export const planReleasedProcessSchema = z.object({
  instanceId: z.string().max(200),
  processId: z.number().int().nullable(),
  kind: z.enum(["local_session", "local_script", "remote_attempt"]),
  confirmed: z.boolean(),
});

/** Append-only evidence on the old run; a new start never deletes its results. */
export const planResourceReleaseSchema = z.object({
  id: z.uuid(),
  userId: z.string().max(200),
  targetRunId: z.string().max(200),
  createdAt: z.string().max(64),
  resources: z.array(z.string().max(4096)),
  processes: z.array(planReleasedProcessSchema),
  confirmed: z.boolean(),
});

/** Minimal resource-owner metadata for the existing start confirmation. */
export const planStartOwnerSchema = z.object({
  runId: z.string().max(200),
  planName: z.string().max(120),
  startedAt: z.string().max(64),
});

/** Start authorization metadata passed to the elected owner, without a private plan snapshot. */
export const planResourceStartSchema = z.object({
  id: z.string().min(1).max(200),
  userId: z.string().min(1).max(200),
  planId: z.string().min(1).max(200),
  sourceRunId: z.string().min(1).max(200).optional(),
});

export type AgentPlanReleasedProcess = z.infer<
  typeof planReleasedProcessSchema
>;
export type AgentPlanResourceRelease = z.infer<
  typeof planResourceReleaseSchema
>;
export type AgentPlanStartOwner = z.infer<typeof planStartOwnerSchema>;
export type AgentPlanResourceStart = z.infer<typeof planResourceStartSchema>;
