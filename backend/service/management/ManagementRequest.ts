import { z } from "zod";

import { AgentOperationError } from "@/backend/error/AgentOperationError";

const identifier = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((text) => !text.includes("\u0000"));
const identifiers = z
  .array(identifier)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length);
const revision = z
  .union([identifier, z.number().int().nonnegative()])
  .transform(String);
const operation = { operationId: z.string().uuid().optional() };
const agent = z
  .object({
    agentMd: z.string().max(100_000),
    soulMd: z.string().max(100_000),
    connectionId: identifier,
    model: identifier,
    reasoningEffort: z.string().max(40).nullable(),
  })
  .strict();
const fields = {
  displayName: identifier,
  email: z.email().max(320).nullable().optional(),
  role: identifier,
  departmentIds: identifiers,
  groupIds: identifiers,
  agent: agent.optional(),
};
/** Creation schema: humans need email; agents need a released model and documents. */
export const managementCreateSchema = z
  .object({
    ...fields,
    ...operation,
    kind: z.enum(["agent", "human"]),
    username: identifier,
  })
  .strict()
  .superRefine((input, context) => {
    if (
      (input.kind === "human" && !input.email) ||
      (input.kind === "agent" && !input.agent)
    )
      context.addIssue({ code: "custom", message: "kind_fields_required" });
  });
/** Patches keep every omitted field and require the complete revision read last. */
export const managementUpdateSchema = z
  .object(fields)
  .partial()
  .extend({ ...operation, expectedRevision: revision })
  .strict();
/** Account status is separate from deletion and does not return credentials. */
export const managementStatusSchema = z
  .object({
    ...operation,
    expectedRevision: revision,
    status: z.enum(["active", "deactivated"]),
  })
  .strict();
/** Avatars accept the contract's MIME types; size is checked before decoding. */
export const managementAvatarSchema = z
  .object({
    ...operation,
    expectedRevision: revision,
    contentType: z.enum([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/svg+xml",
    ]),
    dataBase64: z.string(),
  })
  .strict();
const groupFields = {
  name: identifier,
  description: z.string().max(5000),
  memberIds: identifiers,
  leaderIds: identifiers,
};
/** Complete initial group state. */
export const managementGroupCreateSchema = z
  .object({ ...groupFields, ...operation })
  .strict();
/** Partial group replacement at a known revision. */
export const managementGroupUpdateSchema = z
  .object(groupFields)
  .partial()
  .extend({ ...operation, expectedRevision: revision })
  .strict();
/** Replaces every member and project role, leaving the project itself intact. */
export const managementMembersSchema = z
  .object({
    ...operation,
    expectedRevision: revision,
    members: z
      .array(
        z
          .object({
            userId: identifier,
            role: z.enum(["projectmanager", "member", "viewer"]),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .refine(
    (input) =>
      new Set(input.members.map((member) => member.userId)).size ===
      input.members.length,
  );
/** Assigns at least one department whenever the catalog is nonempty. */
export const managementDepartmentsSchema = z
  .object({
    ...operation,
    expectedRevision: revision,
    departmentIds: identifiers,
  })
  .strict();
/** Filters and stable cursor paging shared by HTTP and internal tools. */
export const managementListSchema = z
  .object({
    query: z.string().max(200).optional(),
    kind: z.enum(["agent", "human"]).optional(),
    departmentId: identifier.optional(),
    groupId: identifier.optional(),
    status: z.enum(["active", "deactivated"]).optional(),
    cursor: z.string().max(2048).nullish(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
/** Validates external input and keeps credential-shaped fields out of diagnostics. */
export function parseManagement<Output>(
  schema: z.ZodType<Output>,
  input: unknown,
): Output {
  const pending: unknown[] = [input];
  while (pending.length > 0) {
    const entry = pending.pop();
    if (typeof entry !== "object" || entry === null) continue;
    for (const [key, content] of Object.entries(entry)) {
      if (/password|token|invitation|secret|apiKey/iu.test(key))
        throw new AgentOperationError("FORBIDDEN", { reason: "core_system" });
      if ((key === "access" || key === "accessLevel") && content === "yolo")
        throw new AgentOperationError("FORBIDDEN", { reason: "access_level" });
      if ((key === "isAdmin" || key === "isAdministrator") && content === true)
        throw new AgentOperationError("FORBIDDEN", { reason: "role_grant" });
      if (typeof content === "object" && content !== null)
        pending.push(content);
    }
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new AgentOperationError("INVALID_REQUEST", { reason: "validation" });
  return parsed.data;
}
/** Public create contract after validation. */
export type ManagementCreate = z.infer<typeof managementCreateSchema>;
/** Public patch contract after validation. */
export type ManagementUpdate = z.infer<typeof managementUpdateSchema>;
/** Public group create contract after validation. */
export type ManagementGroupCreate = z.infer<typeof managementGroupCreateSchema>;
/** Public group patch contract after validation. */
export type ManagementGroupUpdate = z.infer<typeof managementGroupUpdateSchema>;
