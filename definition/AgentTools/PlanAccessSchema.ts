import { IDENTIFIER_SCHEMA } from "./ToolDefinition.js";

import type { PropertySchema } from "./ToolDefinition.js";

/** The canonical team contract, shared by update_plan and clone_plan. */
export const PLAN_TEAMS_SCHEMA: PropertySchema = {
  type: "array",
  maxItems: 50,
  description:
    "The complete new team list of the plan, replacing the old one (empty: no team). Each entry names a group, department or user with canRead, canEdit and canRun. A user must exist and be allowed to read the project, and can only read: canEdit or canRun is refused with plan_user_team_read_only. Edit or run imply read. Members and leaders of a team who can open the project get its rights, each with their own access. Only the owner, an active administrator or a project manager of the project changes teams (FORBIDDEN otherwise); the change is its own revision and is recorded in the plan history.",
  items: {
    type: "object",
    properties: {
      kind: { enum: ["group", "department", "user"] },
      targetId: IDENTIFIER_SCHEMA,
      canRead: { type: "boolean" },
      canEdit: { type: "boolean" },
      canRun: { type: "boolean" },
    },
    required: ["kind", "targetId", "canRead", "canEdit", "canRun"],
    additionalProperties: false,
  },
};

/** An explicit owner choice, restricted to active administrators. */
export const PLAN_OWNER_SCHEMA: PropertySchema = {
  ...IDENTIFIER_SCHEMA,
  description:
    "The account that owns the plan from now on. Only an active human administrator changes the owner (FORBIDDEN otherwise); the new owner must be an active account (INVALID_REQUEST plan_owner_invalid). The change is its own revision and is recorded in the plan history.",
};
