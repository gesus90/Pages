import { randomUUID } from "node:crypto";

import { expect, it, vi } from "vitest";

import { action } from "@/app/routes/ticket-draft";
import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import {
  WorkItemNotFoundError,
  WorkItemValidationError,
} from "@/backend/error/WorkItemErrors";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

const fakes = vi.hoisted(() => ({
  updateDescription: vi.fn(),
  getById: vi.fn(),
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    taskService: {
      updateDescription: fakes.updateDescription,
      getById: fakes.getById,
    },
  }),
}));

const BASE = { description: "Text", updatedAt: "2026-10-15 10:00:00" };

async function save(): Promise<[number, unknown]> {
  const response = await action(
    routeArguments(
      new Request("https://pages.invalid/ticket-api/drafts/t1", {
        method: "POST",
        body: JSON.stringify({
          base: BASE,
          draft: { ...BASE, description: "Edited" },
          streamId: randomUUID(),
          sequence: 1,
        }),
      }),
      EMPLOYEE,
      { ticketId: "t1" },
    ),
  );
  return [response.status, await response.json()];
}

it("saves the description and answers only the description fields", async () => {
  fakes.updateDescription.mockResolvedValue({
    id: "t1",
    title: "Hidden from the answer",
    description: "Edited",
    updatedAt: "2026-10-15 10:02:00",
  });
  expect(await save()).toEqual([
    200,
    {
      ok: true,
      saved: { description: "Edited", updatedAt: "2026-10-15 10:02:00" },
    },
  ]);
  expect(fakes.updateDescription).toHaveBeenCalledWith(EMPLOYEE, "t1", {
    baseDescription: "Text",
    description: "Edited",
  });
});

it("answers another validation failure without reading the ticket", async () => {
  fakes.updateDescription.mockRejectedValue(
    new WorkItemValidationError("descriptionTooLong"),
  );
  expect(await save()).toEqual([
    400,
    { ok: false, error: "descriptionTooLong" },
  ]);
  expect(fakes.getById).not.toHaveBeenCalled();
});

it("answers a conflict on a ticket that vanished without a current value", async () => {
  fakes.updateDescription.mockRejectedValue(
    new WorkItemValidationError("descriptionConflict"),
  );
  fakes.getById.mockResolvedValue(null);
  expect(await save()).toEqual([
    400,
    { ok: false, error: "descriptionConflict" },
  ]);
  expect(fakes.getById).toHaveBeenCalledWith(EMPLOYEE, "t1");
});

it.each<[Error, number, string]>([
  [new WorkItemNotFoundError(), 404, "notFound"],
  [new ProjectAccessDeniedError(), 403, "forbidden"],
])("maps %s", async (failure, status, code) => {
  fakes.updateDescription.mockRejectedValue(failure);
  expect(await save()).toEqual([status, { ok: false, error: code }]);
});

it("rethrows an unexpected failure", async () => {
  const failure = new Error("database");
  fakes.updateDescription.mockRejectedValue(failure);
  await expect(save()).rejects.toBe(failure);
});
