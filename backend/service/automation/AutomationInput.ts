import { z } from "zod";

import { AutomationError } from "@/backend/error/AutomationError";
import { AUTOMATION_LIST_LIMIT } from "@/definition/Automation";
import {
  automationActionSchema,
  automationAgentNotificationSchema,
  automationNameSchema,
  automationReferenceSchema,
  automationSharingSchema,
  automationTriggerSchema,
} from "@/definition/AutomationSchema";

const operationIdSchema = z.uuid();
const revisionSchema = z.number().int().min(1);
const pagingFields = {
  cursor: z.string().max(2048).nullable().optional(),
  limit: z
    .number()
    .int()
    .min(AUTOMATION_LIST_LIMIT.minimum)
    .max(AUTOMATION_LIST_LIMIT.maximum)
    .optional(),
};

/** `read_automation_options` takes no input. */
export const optionsInputSchema = z.strictObject({});

/** `list_automations`. */
export const listInputSchema = z.strictObject({
  ...pagingFields,
  text: z.string().max(200).optional(),
  isActive: z.boolean().optional(),
});

/** `read_automation`. */
export const readInputSchema = z.strictObject({
  automationId: automationReferenceSchema,
});

/** `list_automation_runs`. */
export const runsListInputSchema = z.strictObject({
  automationId: automationReferenceSchema,
  ...pagingFields,
});

/** `read_automation_run`. */
export const runReadInputSchema = z.strictObject({
  automationId: automationReferenceSchema,
  runId: automationReferenceSchema,
});

/** `create_automation`. */
export const createInputSchema = z.strictObject({
  operationId: operationIdSchema,
  name: automationNameSchema,
  trigger: automationTriggerSchema,
  action: automationActionSchema,
  sharing: automationSharingSchema.optional(),
  isActive: z.boolean().optional(),
  deleteAfterSuccess: z.boolean().optional(),
  agentNotification: automationAgentNotificationSchema.optional(),
});

/** `update_automation`: a patch of at least one field. */
export const updateInputSchema = z
  .strictObject({
    operationId: operationIdSchema,
    automationId: automationReferenceSchema,
    expectedRevision: revisionSchema,
    name: automationNameSchema.optional(),
    trigger: automationTriggerSchema.optional(),
    action: automationActionSchema.optional(),
    sharing: automationSharingSchema.optional(),
    isActive: z.boolean().optional(),
    deleteAfterSuccess: z.boolean().optional(),
    agentNotification: automationAgentNotificationSchema.optional(),
  })
  .refine(
    (input) =>
      [
        input.name,
        input.trigger,
        input.action,
        input.sharing,
        input.isActive,
        input.deleteAfterSuccess,
        input.agentNotification,
      ].some((field) => field !== undefined),
    { message: "change_required" },
  );

/** `set_automation_active`. */
export const setActiveInputSchema = z.strictObject({
  operationId: operationIdSchema,
  automationId: automationReferenceSchema,
  expectedRevision: revisionSchema,
  isActive: z.boolean(),
});

/** `run_automation`. */
export const runInputSchema = z.strictObject({
  operationId: operationIdSchema,
  automationId: automationReferenceSchema,
  expectedRevision: revisionSchema,
});

/** `delete_automation`: without `confirmed` only the scope is answered. */
export const deleteInputSchema = z.strictObject({
  operationId: operationIdSchema,
  automationId: automationReferenceSchema,
  expectedRevision: revisionSchema,
  confirmed: z.boolean().optional(),
  confirmation: z.string().max(20).optional(),
});

/** Input of a patch, as read. */
export type AutomationUpdateInput = z.infer<typeof updateInputSchema>;
/** Input of a creation, as read. */
export type AutomationCreateInput = z.infer<typeof createInputSchema>;

/**
 * Reads the input of an operation.
 *
 * @param schema - The schema of the operation.
 * @param input - The raw input; `undefined` counts as an empty object.
 * @throws {AutomationError} `invalid_request` with the paths and messages of
 * every problem, never with the values.
 */
export function readAutomationInput<Output>(
  schema: z.ZodType<Output>,
  input: unknown,
): Output {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  throw new AutomationError("invalid_request", {
    reason: "validation",
    problems: result.error.issues
      .slice(0, 20)
      .map((issue) => `${issue.path.join(".") || "$"}: ${issue.message}`),
  });
}

interface AutomationCursor {
  readonly createdAt?: string;
  readonly id?: string;
  readonly sequence?: number;
}

/** Encodes the position after the last item of a page. */
export function encodeAutomationCursor(cursor: AutomationCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

const cursorSchema = z.strictObject({
  createdAt: z.string().max(40).optional(),
  id: z.string().max(200).optional(),
  sequence: z.number().int().min(1).optional(),
});

/**
 * Reads a cursor of an earlier page.
 *
 * @throws {AutomationError} `invalid_request` for a cursor Pages did not issue.
 */
export function decodeAutomationCursor(
  value: string | null | undefined,
): AutomationCursor | null {
  if (!value) return null;
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  } catch {
    throw new AutomationError("invalid_request", {
      reason: "validation",
      problems: ["cursor: invalid"],
    });
  }
}
