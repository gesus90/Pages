import {
  AUTOMATION_EVENT_TYPES,
  AUTOMATION_FORWARD_CONDITIONS,
  AUTOMATION_INSTRUCTION_LENGTH,
  AUTOMATION_INTERVAL_SECONDS,
  AUTOMATION_NAME_LENGTH,
  AUTOMATION_NOTIFICATION_MODES,
  AUTOMATION_TIME_UNITS,
} from "../Automation.js";
import {
  PLAN_SCRIPT_CONTENT_LENGTH,
  PLAN_SCRIPT_TIMEOUT,
} from "../AgentPlanScript.js";
import {
  CURSOR_SCHEMA,
  IDENTIFIER_SCHEMA,
  LIMIT_SCHEMA,
  NULLABLE_IDENTIFIER_SCHEMA,
  REVISION_SCHEMA,
  buildReadTool,
  buildWriteTool,
} from "./ToolDefinition.js";

import type { PropertySchema } from "./ToolDefinition.js";
import type { Tool } from "@modelcontextprotocol/server";
import type {
  AutomationReadOperation,
  AutomationWriteOperation,
} from "../AutomationOperations.js";

const TIME: PropertySchema = {
  type: "string",
  pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$",
};
const TIME_ZONE: PropertySchema = {
  type: "string",
  minLength: 1,
  maxLength: 64,
};
const WEEKDAYS: PropertySchema = {
  type: "array",
  minItems: 1,
  maxItems: 7,
  uniqueItems: true,
  items: { type: "integer", minimum: 1, maximum: 7 },
};
const WINDOW: PropertySchema = {
  type: "object",
  properties: { start: TIME, end: TIME },
  required: ["start", "end"],
  additionalProperties: false,
};

/** The binding JSON Schema of a trigger; the same union the editor writes. */
export const AUTOMATION_TRIGGER_SCHEMA: PropertySchema = {
  oneOf: [
    {
      type: "object",
      properties: { type: { const: "manual" } },
      required: ["type"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "once" },
        at: { type: "string", format: "date-time", maxLength: 40 },
        timeZone: TIME_ZONE,
      },
      required: ["type", "at", "timeZone"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "interval" },
        every: {
          type: "integer",
          minimum: 1,
          maximum: AUTOMATION_INTERVAL_SECONDS.maximum,
        },
        unit: { enum: [...AUTOMATION_TIME_UNITS] },
        timeZone: TIME_ZONE,
        weekdays: WEEKDAYS,
        window: WINDOW,
      },
      required: ["type", "every", "unit", "timeZone"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "weekly" },
        weekdays: WEEKDAYS,
        times: {
          type: "array",
          minItems: 1,
          maxItems: 48,
          uniqueItems: true,
          items: TIME,
        },
        timeZone: TIME_ZONE,
        window: WINDOW,
      },
      required: ["type", "weekdays", "times", "timeZone"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "event" },
        eventType: { enum: [...AUTOMATION_EVENT_TYPES] },
        planId: NULLABLE_IDENTIFIER_SCHEMA,
        stepId: NULLABLE_IDENTIFIER_SCHEMA,
        projectId: NULLABLE_IDENTIFIER_SCHEMA,
        statusId: NULLABLE_IDENTIFIER_SCHEMA,
      },
      required: ["type", "eventType"],
      additionalProperties: false,
    },
  ],
};

/** The binding JSON Schema of an action. */
export const AUTOMATION_ACTION_SCHEMA: PropertySchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        type: { const: "agent" },
        agentId: IDENTIFIER_SCHEMA,
        instruction: {
          type: "string",
          minLength: 1,
          maxLength: AUTOMATION_INSTRUCTION_LENGTH,
        },
      },
      required: ["type", "agentId", "instruction"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: { const: "script" },
        workspaceId: IDENTIFIER_SCHEMA,
        interpreterProfileId: {
          type: "string",
          minLength: 1,
          maxLength: 80,
          pattern: "^[a-zA-Z0-9-]+$",
        },
        content: {
          type: "string",
          minLength: 1,
          maxLength: PLAN_SCRIPT_CONTENT_LENGTH,
        },
        timeoutSeconds: {
          type: "integer",
          minimum: PLAN_SCRIPT_TIMEOUT.minimum,
          maximum: PLAN_SCRIPT_TIMEOUT.maximum,
        },
        forward: {
          type: ["object", "null"],
          properties: {
            agentId: IDENTIFIER_SCHEMA,
            when: { enum: [...AUTOMATION_FORWARD_CONDITIONS] },
          },
          required: ["agentId", "when"],
          additionalProperties: false,
        },
      },
      required: [
        "type",
        "workspaceId",
        "interpreterProfileId",
        "content",
        "timeoutSeconds",
      ],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { type: { const: "plan" }, planId: IDENTIFIER_SCHEMA },
      required: ["type", "planId"],
      additionalProperties: false,
    },
  ],
};

/** The binding JSON Schema of a share. */
export const AUTOMATION_SHARING_SCHEMA: PropertySchema = {
  oneOf: [
    {
      type: "object",
      properties: { scope: { const: "private" } },
      required: ["scope"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { scope: { const: "project" }, projectId: IDENTIFIER_SCHEMA },
      required: ["scope", "projectId"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { scope: { const: "group" }, groupId: IDENTIFIER_SCHEMA },
      required: ["scope", "groupId"],
      additionalProperties: false,
    },
  ],
};

/** The binding JSON Schema of the optional agent notification. */
export const AUTOMATION_NOTIFICATION_SCHEMA: PropertySchema = {
  type: "object",
  properties: {
    mode: { enum: [...AUTOMATION_NOTIFICATION_MODES] },
    agentId: NULLABLE_IDENTIFIER_SCHEMA,
  },
  required: ["mode"],
  additionalProperties: false,
};

const NAME: PropertySchema = {
  type: "string",
  minLength: 1,
  maxLength: AUTOMATION_NAME_LENGTH,
};
const AUTOMATION_ID = { automationId: IDENTIFIER_SCHEMA };

const RULES =
  "An automation wakes an agent (action agent: the instruction goes into the agent's own automation session, never into a person's chat), runs a script (administrators only, like scripts in plans) or starts a new run of a plan, triggered manually, once at a time, in an interval (every 1 second to 1 year, optionally only on weekdays and within a window) or weekly at fixed times, or by an event (plan.started, plan.succeeded, plan.failed, plan.step_changed, ticket.created, ticket.status_changed; the event data goes to the action as JSON). Times use the IANA time zone of the trigger and follow daylight saving time. Every run uses exactly the rights of the creator; rights are checked on save and again before every run, and a missing right ends the run as forbidden and pauses the automation. A share (private, a project or a user group the creator belongs to) only lets members see it; the creator, managers of a shared project and administrators change, run and delete it. Readers never see script content.";
const ERRORS =
  "Errors: INVALID_REQUEST (details.reason such as time_required, delete_after_success_invalid, event_filter_invalid, sharing_target_invalid, interpreter_unavailable, validation), FORBIDDEN (script_forbidden, agent_unavailable, plan_unavailable, workspace_unavailable, read_only), NOT_FOUND for missing and hidden automations alike, CONFLICT with details.currentRevision when expectedRevision is stale or the operationId was used for other input.";
const WRITE_RULES = `Reuse operationId (a UUID) with identical input after a lost response to receive the stored receipt without a second effect. ${ERRORS}`;

/** Reads of automations and their runs. */
export const AUTOMATION_READ_TOOLS: readonly {
  readonly operation: AutomationReadOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "automations.options.read",
    tool: buildReadTool({
      name: "read_automation_options",
      title: "Read automation options",
      description: `Returns what the account may choose for automations: allowed trigger and action kinds (script only for active administrators), the binding JSON Schemas of trigger, action, sharing and agentNotification, limits, time zones and the default one, selectable agents, visible plans with their steps and canStart, projects with their statuses for ticket events, projects and user groups the account can share with, and for administrators workspaces and interpreter profiles. References and names only, never credentials or paths. ${RULES}`,
      properties: {},
    }),
  },
  {
    operation: "automations.list",
    tool: buildReadTool({
      name: "list_automations",
      title: "List automations",
      description: `Lists the automations the account can see, oldest first: id, revision, creator {accountId, kind human|agent, displayName}, name, trigger, action, sharing, isActive, deleteAfterSuccess, agentNotification, nextRunAt, lastRun and permissions {canRead, canEdit, canRun, canDelete}. text keeps names containing it (case-insensitive), isActive filters by state. limit 1..100 (default 50); pass nextCursor to continue. ${RULES}`,
      properties: {
        cursor: CURSOR_SCHEMA,
        limit: LIMIT_SCHEMA,
        text: NAME,
        isActive: { type: "boolean" },
      },
    }),
  },
  {
    operation: "automations.read",
    tool: buildReadTool({
      name: "read_automation",
      title: "Read automation",
      description: `Reads one visible automation with its revision, trigger, action (script content only for its creator or an administrator who may change it), sharing, next run, last run and permissions. ${RULES}`,
      properties: AUTOMATION_ID,
      required: ["automationId"],
    }),
  },
  {
    operation: "automations.runs.list",
    tool: buildReadTool({
      name: "list_automation_runs",
      title: "List automation runs",
      description:
        "Lists the runs of one visible automation, newest first: runId, automationId, queuedAt, startedAt, endedAt, trigger {kind, eventType, subject}, status (queued waits behind a running run, accepted is claimed or waits for a busy agent, delivered runs, completed and failed have ended), result {outcome ok|failed|forbidden|skipped, exitCode, forward woken|not_woken, planRunId, planRunStatus, paused, errorCode, summary} and duration in milliseconds. The last 50 runs per automation are kept. limit 1..100 (default 50); pass nextCursor to continue.",
      properties: {
        ...AUTOMATION_ID,
        cursor: CURSOR_SCHEMA,
        limit: LIMIT_SCHEMA,
      },
      required: ["automationId"],
    }),
  },
  {
    operation: "automations.runs.read",
    tool: buildReadTool({
      name: "read_automation_run",
      title: "Read automation run",
      description:
        "Reads one run of a visible automation: everything of the list plus the agent's final answer (first 4 KiB), the end of a script's output (last 64 KiB, only for accounts that may see the script), the error, the trigger data handed to the action and every delivery to an agent {agentId, kind action|forward|notification, state queued|delivered|completed|failed}. A delivered delivery only means the agent's turn started; completed means it ended with an answer.",
      properties: { ...AUTOMATION_ID, runId: IDENTIFIER_SCHEMA },
      required: ["automationId", "runId"],
    }),
  },
];

/** Changes of automations; Pages checks every right on each call. */
export const AUTOMATION_WRITE_TOOLS: readonly {
  readonly operation: AutomationWriteOperation;
  readonly tool: Tool;
}[] = [
  {
    operation: "automations.create",
    tool: buildWriteTool({
      name: "create_automation",
      title: "Create automation",
      description: `Creates an automation owned by the connected account (never another one). Defaults: sharing private, isActive false, deleteAfterSuccess false, agentNotification {mode: off}. A once trigger needs a time in the future; deleteAfterSuccess (only for once) deletes the automation with its history after a successful run, a failed run pauses it instead; without it a once automation is switched off after its run and loses its time. agentNotification {mode off|error|always, agentId} wakes that agent with the result in its own notification session, independent of the action. Returns the stored automation with its revision. ${RULES} ${WRITE_RULES}`,
      properties: {
        name: NAME,
        trigger: AUTOMATION_TRIGGER_SCHEMA,
        action: AUTOMATION_ACTION_SCHEMA,
        sharing: AUTOMATION_SHARING_SCHEMA,
        isActive: { type: "boolean" },
        deleteAfterSuccess: { type: "boolean" },
        agentNotification: AUTOMATION_NOTIFICATION_SCHEMA,
      },
      optionalKeys: [
        "sharing",
        "isActive",
        "deleteAfterSuccess",
        "agentNotification",
      ],
      isDestructive: false,
    }),
  },
  {
    operation: "automations.update",
    tool: buildWriteTool({
      name: "update_automation",
      title: "Update automation",
      description: `Patches an automation: omitted fields stay, a given trigger, action, sharing or agentNotification replaces the whole object. The creator never changes. Switching a once automation on needs a time in the future (INVALID_REQUEST time_required otherwise); switching it off after its time passed clears the time. Pass the revision read last as expectedRevision. ${WRITE_RULES}`,
      properties: {
        ...AUTOMATION_ID,
        expectedRevision: REVISION_SCHEMA,
        name: NAME,
        trigger: AUTOMATION_TRIGGER_SCHEMA,
        action: AUTOMATION_ACTION_SCHEMA,
        sharing: AUTOMATION_SHARING_SCHEMA,
        isActive: { type: "boolean" },
        deleteAfterSuccess: { type: "boolean" },
        agentNotification: AUTOMATION_NOTIFICATION_SCHEMA,
      },
      optionalKeys: [
        "name",
        "trigger",
        "action",
        "sharing",
        "isActive",
        "deleteAfterSuccess",
        "agentNotification",
      ],
      isDestructive: true,
    }),
  },
  {
    operation: "automations.setActive",
    tool: buildWriteTool({
      name: "set_automation_active",
      title: "Switch automation on or off",
      description: `Switches an automation on or off. Off only stops future triggers; a running run finishes. A once automation without a time in the future cannot be switched on. Returns the stored automation with its new revision. ${WRITE_RULES}`,
      properties: {
        ...AUTOMATION_ID,
        expectedRevision: REVISION_SCHEMA,
        isActive: { type: "boolean" },
      },
      isDestructive: false,
    }),
  },
  {
    operation: "automations.run",
    tool: buildWriteTool({
      name: "run_automation",
      title: "Run automation now",
      description: `Runs an automation now with the creator's rights, also while it is switched off. Returns a receipt {runId, status accepted|queued, isCoalesced, queuedAt}: accepted starts at once, queued waits behind the running run; a further call while one waits joins it (isCoalesced). The receipt is no finished run; read_automation_run tells when it ended. ${WRITE_RULES}`,
      properties: { ...AUTOMATION_ID, expectedRevision: REVISION_SCHEMA },
      isDestructive: false,
      isOpenWorld: true,
    }),
  },
  {
    operation: "automations.delete",
    tool: buildWriteTool({
      name: "delete_automation",
      title: "Delete automation",
      description: `Deletes an automation with its history. Without confirmed true nothing changes and the answer names the scope: automationId, name, expectedRevision, runCount, blockingRunId and canDelete. Only an explicit later confirmation of exactly that scope deletes; a running or waiting run blocks the deletion (CONFLICT run_active) and nothing else is stopped. Never confirm on your own: the person must confirm. ${WRITE_RULES}`,
      properties: {
        ...AUTOMATION_ID,
        expectedRevision: REVISION_SCHEMA,
        confirmed: { type: "boolean" },
      },
      optionalKeys: ["confirmed"],
      isDestructive: true,
    }),
  },
];
