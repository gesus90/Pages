import { READ_ANNOTATIONS, DESTRUCTIVE_ANNOTATIONS } from "./ToolDefinition.js";
import type { Tool } from "@modelcontextprotocol/server";

const ticketId = { type: "string", minLength: 1, maxLength: 200 } as const;
const text = { type: "string", minLength: 1, maxLength: 2000 } as const;

/** Bound-run metadata reads use the executor's current ticket visibility. */
export const PLAN_WORK_READ_TOOL = {
  name: "read_ticket_work",
  title: "Read ticket work scope",
  description:
    "Reads the current explicit work scope and required check evidence for a bound ticket of this running node. Returns run/node/attempt, real checklist IDs, current ticket hashes and metadata revision. Available only to a run with completionGate version 1; never grants plan control or ticket writes.",
  inputSchema: {
    type: "object",
    properties: { ticketId },
    required: ["ticketId"],
    additionalProperties: false,
  },
  annotations: READ_ANNOTATIONS,
} satisfies Tool;

/** Metadata is separate from the final result consumed by scripts. */
export const PLAN_WORK_SAVE_TOOL = {
  name: "save_ticket_work",
  title: "Save ticket work scope or confirmation",
  description:
    "Saves separate work metadata of this running node, never ticket checkboxes or status. Read ticket/work first. action scope explicitly classifies every current checklist ID as relevant or excluded with a reason before implementation; scope changes need a concrete note. action confirm keeps the previously stored scope and requires fresh hashes, every relevant item checked with factual proof, and all configured checks with actual command, exitCode 0 and evidence. expectedRevision is metadata revision (0 if absent). Stale versions return CONFLICT: read again and preserve concurrent changes. Retry after a lost response by reading the current record. Final JSON stays unchanged. Read-only agents cannot save. A reporting credential acquires no additional rights.",
  inputSchema: {
    type: "object",
    properties: {
      ticketId,
      action: { enum: ["scope", "confirm"] },
      expectedRevision: { type: "integer", minimum: 0 },
      requirementsHash: text,
      contentHash: text,
      note: text,
      scope: {
        type: "array",
        maxItems: 1000,
        items: {
          type: "object",
          properties: {
            itemId: text,
            relevant: { type: "boolean" },
            reason: { type: "string", maxLength: 2000 },
          },
          required: ["itemId", "relevant", "reason"],
          additionalProperties: false,
        },
      },
      proofs: {
        type: "array",
        maxItems: 1000,
        items: {
          type: "object",
          properties: { itemId: text, evidence: text },
          required: ["itemId", "evidence"],
          additionalProperties: false,
        },
      },
      checks: {
        type: "array",
        maxItems: 30,
        items: {
          type: "object",
          properties: {
            name: text,
            command: text,
            exitCode: { type: "integer" },
            evidence: text,
          },
          required: ["name", "command", "exitCode", "evidence"],
          additionalProperties: false,
        },
      },
    },
    required: [
      "ticketId",
      "action",
      "expectedRevision",
      "requirementsHash",
      "contentHash",
      "scope",
      "note",
      "proofs",
      "checks",
    ],
    additionalProperties: false,
  },
  annotations: DESTRUCTIVE_ANNOTATIONS,
} satisfies Tool;
