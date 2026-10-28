import { expect, it, vi } from "vitest";

import { action } from "@/app/routes/ticket-attachments";
import {
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";

import { EMPLOYEE, thrownResponse } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { User } from "@/definition/User";

const upload = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({ taskAttachmentService: { upload } }),
}));

function put(
  user: User | null,
  query: string,
  method = "PUT",
): Promise<Response> {
  return action(
    routeArguments(
      new Request(`http://pages.invalid/aufgaben-api/attachments${query}`, {
        method,
        body: "file",
      }),
      user,
      {},
    ),
  );
}

it("allows only PUT", async () => {
  const response = await thrownResponse(put(EMPLOYEE, "", "POST"));
  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("PUT");
});

it("refuses visitors without a session", async () => {
  expect((await thrownResponse(put(null, ""))).status).toBe(403);
  expect(upload).not.toHaveBeenCalled();
});

it("uploads the body to the named ticket", async () => {
  upload.mockResolvedValue({ id: "attachment" });
  const response = await put(EMPLOYEE, "?ticket=t1&name=plan.pdf");
  expect(await response.json()).toEqual({ attachment: { id: "attachment" } });
  expect(upload.mock.calls[0]?.slice(0, 2)).toEqual([EMPLOYEE, "t1"]);
  expect(upload.mock.calls[0]?.[2]).toMatchObject({ fileName: "plan.pdf" });
});

it("passes empty ticket and name values when the query lacks them", async () => {
  upload.mockResolvedValue({ id: "attachment" });
  await put(EMPLOYEE, "");
  expect(upload.mock.calls.at(-1)?.[1]).toBe("");
  expect(upload.mock.calls.at(-1)?.[2]).toMatchObject({ fileName: "" });
});

it.each<[Error, number, string]>([
  [
    new WorkItemValidationError("attachmentTooLarge"),
    413,
    "attachmentTooLarge",
  ],
  [new WorkItemNotFoundError(), 404, "notFound"],
])("maps %s to a JSON error", async (failure, status, code) => {
  upload.mockRejectedValue(failure);
  const response = await put(EMPLOYEE, "?ticket=t1&name=a");
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: code });
});

it("rethrows a failure that is not the person's doing", async () => {
  const failure = new Error("disk");
  upload.mockRejectedValue(failure);
  await expect(put(EMPLOYEE, "?ticket=t1&name=a")).rejects.toBe(failure);
});
