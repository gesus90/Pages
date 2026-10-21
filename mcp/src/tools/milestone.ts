import {
  ADDITIVE_ANNOTATIONS,
  DESTRUCTIVE_ANNOTATIONS,
  IDENTIFIER_SCHEMA,
} from "./tool-definition.js";

import type { Tool } from "@modelcontextprotocol/server";
import type { PropertySchema } from "./tool-definition.js";

const DATE: PropertySchema = {
  type: ["string", "null"],
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
};
const STATUS: PropertySchema = { enum: ["open", "completed", "archived"] };
const LINK_TYPE: PropertySchema = {
  enum: ["prerequisite", "follows", "blocks", "relates_to"],
};
const RIGHTS =
  "Needs the right to manage the project, like the milestone page: an account that only writes tickets returns FORBIDDEN, and a project you cannot see returns NOT_FOUND.";
const REPLAY =
  "Reuse operationId with identical input to recover the stored result after response loss; changed input returns CONFLICT. JSON request maximum 64 KiB.";

interface MilestoneFieldSpecification {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** The argument that carries the value that was read, and the one that carries the new value. */
  readonly expected: string;
  readonly value: string;
  readonly schema: PropertySchema;
}

function milestoneFieldTool(specification: MilestoneFieldSpecification): Tool {
  return {
    name: specification.name,
    title: specification.title,
    description: `${specification.description} milestoneId is a milestone ID from read_milestones. The expected value is the one you read; if the field was saved with another value since then the call returns CONFLICT and nothing changes. Only this field changes. ${RIGHTS} ${REPLAY}`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        operationId: IDENTIFIER_SCHEMA,
        milestoneId: IDENTIFIER_SCHEMA,
        [specification.expected]: specification.schema,
        [specification.value]: specification.schema,
      },
      required: [
        "operationId",
        "milestoneId",
        specification.expected,
        specification.value,
      ],
    },
    annotations: DESTRUCTIVE_ANNOTATIONS,
  };
}

/** Creates one milestone in an explicit project. */
export const MILESTONE_CREATE_TOOL: Tool = {
  name: "create_milestone",
  title: "Create milestone",
  description: `Creates one open milestone in an explicit project. startAt and dueAt are dates (YYYY-MM-DD) or null; the start must not be after the due date. ${RIGHTS} ${REPLAY}`,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      operationId: IDENTIFIER_SCHEMA,
      projectId: IDENTIFIER_SCHEMA,
      name: IDENTIFIER_SCHEMA,
      description: { type: "string" },
      startAt: DATE,
      dueAt: DATE,
    },
    required: [
      "operationId",
      "projectId",
      "name",
      "description",
      "startAt",
      "dueAt",
    ],
  },
  annotations: ADDITIVE_ANNOTATIONS,
};

/** Changes only the name of one milestone. */
export const MILESTONE_SET_NAME_TOOL: Tool = milestoneFieldTool({
  name: "set_milestone_name",
  title: "Set milestone name",
  description:
    "Sets the name of one milestone (1 to 200 characters); description, status and dates stay unchanged.",
  expected: "expectedName",
  value: "name",
  schema: IDENTIFIER_SCHEMA,
});

/** Changes only the description of one milestone. */
export const MILESTONE_SET_DESCRIPTION_TOOL: Tool = milestoneFieldTool({
  name: "set_milestone_description",
  title: "Set milestone description",
  description:
    "Replaces the description of one milestone; name, status and dates stay unchanged.",
  expected: "expectedDescription",
  value: "description",
  schema: { type: "string" },
});

/** Changes only the status of one milestone. */
export const MILESTONE_SET_STATUS_TOOL: Tool = milestoneFieldTool({
  name: "set_milestone_status",
  title: "Set milestone status",
  description:
    "Sets the status of one milestone to open, completed or archived; name, description and dates stay unchanged.",
  expected: "expectedStatus",
  value: "status",
  schema: STATUS,
});

/** Changes only the start date of one milestone. */
export const MILESTONE_SET_START_TOOL: Tool = milestoneFieldTool({
  name: "set_milestone_start",
  title: "Set milestone start date",
  description:
    "Sets the start date (YYYY-MM-DD) of one milestone, or removes it with null; it must not be after the due date. Other fields stay unchanged. expectedStartAt is the startAt you read.",
  expected: "expectedStartAt",
  value: "startAt",
  schema: DATE,
});

/** Changes only the due date of one milestone. */
export const MILESTONE_SET_DUE_TOOL: Tool = milestoneFieldTool({
  name: "set_milestone_due",
  title: "Set milestone due date",
  description:
    "Sets the due date (YYYY-MM-DD) of one milestone, or removes it with null; it must not be before the start date. Other fields stay unchanged. expectedDueAt is the dueAt you read.",
  expected: "expectedDueAt",
  value: "dueAt",
  schema: DATE,
});

/** Links two milestones of one project. */
export const MILESTONE_DEPENDENCY_ADD_TOOL: Tool = {
  name: "add_milestone_dependency",
  title: "Add milestone dependency",
  description: `Links two different milestones of one project from sourceId to targetId. linkType is prerequisite, follows, blocks or relates_to. Two milestones that are already linked in either direction return CONFLICT. ${RIGHTS} ${REPLAY}`,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      operationId: IDENTIFIER_SCHEMA,
      projectId: IDENTIFIER_SCHEMA,
      sourceId: IDENTIFIER_SCHEMA,
      targetId: IDENTIFIER_SCHEMA,
      linkType: LINK_TYPE,
    },
    required: ["operationId", "projectId", "sourceId", "targetId", "linkType"],
  },
  annotations: ADDITIVE_ANNOTATIONS,
};

/** Removes one dependency between milestones. */
export const MILESTONE_DEPENDENCY_REMOVE_TOOL: Tool = {
  name: "remove_milestone_dependency",
  title: "Remove milestone dependency",
  description: `Removes one dependency of a project; dependencyId is an ID from read_milestones. The milestones themselves stay. A dependency that does not exist returns NOT_FOUND. ${RIGHTS} ${REPLAY}`,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      operationId: IDENTIFIER_SCHEMA,
      projectId: IDENTIFIER_SCHEMA,
      dependencyId: IDENTIFIER_SCHEMA,
    },
    required: ["operationId", "projectId", "dependencyId"],
  },
  annotations: DESTRUCTIVE_ANNOTATIONS,
};
