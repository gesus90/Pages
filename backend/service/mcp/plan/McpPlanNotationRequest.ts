import { z } from "zod";

import { McpPlanNotationError } from "./McpPlanNotationError";

import type { PlanRankDirection } from "@/definition/AgentPlanAutoLayout";

/** A plan identifier as the plan reader bounds it: up to 100 characters without control characters. */
const identifierField = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[^\u0000-\u001f\u007f]+$/u);
const notationField = z.string();
const revisionField = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
/**
 * The operation identifier Pages MCP sends with every write; saving a whole
 * plan has no replay of its own, so it is read and not used further.
 */
const operationIdField = identifierField.optional();

const checkSchema = z
  .object({ notation: notationField, planId: identifierField.optional() })
  .strict();
const createSchema = z
  .object({ notation: notationField, operationId: operationIdField })
  .strict();
const replaceSchema = z
  .object({
    notation: notationField,
    expectedRevision: revisionField,
    operationId: operationIdField,
  })
  .strict();
const layoutSchema = z
  .object({
    expectedRevision: revisionField,
    operationId: operationIdField,
    rankdir: z.enum(["TB", "LR"]).optional(),
  })
  .strict();

/** `POST /plan-notation/check`. */
export interface McpPlanNotationCheckRequest {
  readonly notation: string;
  readonly planId?: string;
}

/** `PUT /plan-notation/{planId}`. */
export interface McpPlanNotationReplaceRequest {
  readonly notation: string;
  readonly expectedRevision: number;
  readonly operationId?: string;
}

/** `POST /plan-notation/{planId}/layout`. */
export interface McpPlanNotationLayoutRequest {
  readonly expectedRevision: number;
  readonly rankdir?: PlanRankDirection;
  readonly operationId?: string;
}

function parsed<Output>(
  schema: z.ZodType<Output>,
  body: Readonly<Record<string, unknown>>,
): Output {
  const result = schema.safeParse(body);
  if (!result.success) throw new McpPlanNotationError("invalid_request");
  return result.data;
}

/**
 * Reads the bodies of the plan notation API (PAGE-250).
 *
 * @remarks
 * Every body is strict: a field the interface does not name is an invalid
 * request, so a client learns about a typo instead of a silent default. The
 * writes also admit the `operationId` that Pages MCP sends with every write.
 */
export const McpPlanNotationRequest = {
  /** Reads `{ "notation", "planId"? }`. */
  check(body: Readonly<Record<string, unknown>>): McpPlanNotationCheckRequest {
    return parsed(checkSchema, body);
  },
  /** Reads `{ "notation", "operationId"? }`. */
  create(body: Readonly<Record<string, unknown>>): string {
    return parsed(createSchema, body).notation;
  },
  /** Reads `{ "notation", "expectedRevision", "operationId"? }`. */
  replace(
    body: Readonly<Record<string, unknown>>,
  ): McpPlanNotationReplaceRequest {
    return parsed(replaceSchema, body);
  },
  /** Reads `{ "expectedRevision", "rankdir"?, "operationId"? }`. */
  layout(
    body: Readonly<Record<string, unknown>>,
  ): McpPlanNotationLayoutRequest {
    return parsed(layoutSchema, body);
  },
  /**
   * Reads the plan identifier of a path.
   *
   * @throws {McpPlanNotationError} `not_found` for a missing or malformed identifier.
   */
  planId(value: string | undefined): string {
    const result = identifierField.safeParse(value);
    if (!result.success) throw new McpPlanNotationError("not_found");
    return result.data;
  },
} as const;
