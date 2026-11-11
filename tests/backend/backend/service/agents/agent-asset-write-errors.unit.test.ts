import { expect, it } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import {
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";
import { translateAssetWriteError } from "@/backend/service/agents/AgentAssetWriteErrors";

it("reports an oversized ticket attachment as a too large payload", () => {
  expect(
    translateAssetWriteError(new WorkItemValidationError("attachmentTooLarge")),
  ).toMatchObject({ code: "PAYLOAD_TOO_LARGE", status: 413 });
});

it("reports an oversized wiki file as a too large payload", () => {
  expect(
    translateAssetWriteError(new WikiValidationError("fileTooLarge")),
  ).toMatchObject({ code: "PAYLOAD_TOO_LARGE", status: 413 });
});

it("keeps a refused wiki page action apart from a hidden or malformed one", () => {
  expect(translateAssetWriteError(new WikiAccessDeniedError())).toMatchObject({
    code: "FORBIDDEN",
  });
  expect(translateAssetWriteError(new WikiPageNotFoundError())).toMatchObject({
    code: "NOT_FOUND",
  });
  expect(
    translateAssetWriteError(new WikiValidationError("fileEmpty")),
  ).toMatchObject({ code: "INVALID_REQUEST" });
});

it("hands every other failure to the ticket translation", () => {
  expect(translateAssetWriteError(new WorkItemNotFoundError())).toBeInstanceOf(
    AgentOperationError,
  );
  expect(translateAssetWriteError(new WorkItemNotFoundError())).toMatchObject({
    code: "NOT_FOUND",
  });
  expect(
    translateAssetWriteError(
      new WorkItemValidationError("attachmentUploadRequired"),
    ),
  ).toMatchObject({
    code: "INVALID_REQUEST",
    details: { reason: "ticket_attachment_upload_required" },
  });
});

it("returns unrelated errors unchanged", () => {
  const unknown = new Error("disk full");
  expect(translateAssetWriteError(unknown)).toBe(unknown);
  expect(translateAssetWriteError("text")).toBe("text");
});
