import { expect, it } from "vitest";

import { describeTicketUploadFailure } from "@/app/lib/task-actions/ticket-upload.server";
import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import {
  WorkItemAccessDeniedError,
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";

it.each([
  [
    "an oversized file",
    new WorkItemValidationError("attachmentTooLarge"),
    { error: "attachmentTooLarge", status: 413 },
  ],
  [
    "an empty file",
    new WorkItemValidationError("attachmentFileEmpty"),
    { error: "attachmentFileEmpty", status: 400 },
  ],
  [
    "a missing ticket",
    new WorkItemNotFoundError(),
    { error: "notFound", status: 404 },
  ],
  [
    "a hidden project",
    new ProjectAccessDeniedError(),
    { error: "notFound", status: 404 },
  ],
  [
    "a denied ticket",
    new WorkItemAccessDeniedError(),
    { error: "forbidden", status: 403 },
  ],
])("describes %s", (caseName, error, expected) => {
  expect(describeTicketUploadFailure(error)).toEqual(expected);
});

it("leaves failures that are not the person's doing to the caller", () => {
  expect(describeTicketUploadFailure(new Error("disk full"))).toBeNull();
  expect(describeTicketUploadFailure("text")).toBeNull();
});
