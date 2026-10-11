import { expect, it } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import {
  ProjectAccessDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";
import {
  WorkItemAccessDeniedError,
  WorkItemConflictError,
  WorkItemHierarchyError,
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";
import { translateAgentTicketError } from "@/backend/service/agents/AgentTicketErrors";

it.each([
  [new WorkItemNotFoundError(), "NOT_FOUND"],
  [new ProjectNotFoundError(), "NOT_FOUND"],
  [new ProjectAccessDeniedError(), "NOT_FOUND"],
  [new WorkItemAccessDeniedError(), "FORBIDDEN"],
  [new WorkItemConflictError("title"), "CONFLICT"],
  [new WorkItemHierarchyError("epicMissing"), "NOT_FOUND"],
  [new WorkItemHierarchyError("taskSelfParent"), "INVALID_REQUEST"],
  ...(
    [
      "statusNotFound",
      "targetStatusNotFound",
      "milestoneNotFound",
      "milestoneOtherProject",
      "dependencyNotFound",
    ] as const
  ).map((code) => [new WorkItemValidationError(code), "NOT_FOUND"] as const),
  ...(
    ["descriptionConflict", "dependencyExists", "ticketArchived"] as const
  ).map((code) => [new WorkItemValidationError(code), "CONFLICT"] as const),
  [new WorkItemValidationError("titleLength"), "INVALID_REQUEST"],
] as const)(
  "translates %s to %s without exposing hidden details",
  (error, code) => {
    const translated = translateAgentTicketError(error);
    expect(translated).toBeInstanceOf(AgentOperationError);
    expect(translated).toMatchObject({
      code,
      status: new AgentOperationError(code).status,
      details: undefined,
    });
  },
);

it.each([
  new Error("storage failure"),
  new AgentOperationError("CONFLICT"),
  null,
  "unexpected",
])("preserves failures outside the business error contract: %j", (error) => {
  expect(translateAgentTicketError(error)).toBe(error);
});
