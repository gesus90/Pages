import { expect, it } from "vitest";

import {
  invalidInput,
  runTaskAction,
  runTaskActionThenRedirect,
  runTicketAction,
} from "@/app/lib/task-actions/task-action-support.server";
import { GitHubApiError } from "@/backend/github/GitHubApiClient";
import {
  WorkItemAccessDeniedError,
  WorkItemHierarchyError,
  WorkItemNotFoundError,
  WorkItemValidationError,
  WorkItemConflictError,
} from "@/backend/error/WorkItemErrors";

import { outcomeOf } from "../../actions/action-fixtures";

async function failWith(error: unknown): Promise<never> {
  return Promise.reject(error);
}

it("answers malformed input with 400 invalidInput", async () => {
  expect(await outcomeOf(invalidInput("move-task"))).toMatchObject({
    status: 400,
    body: { ok: false, intent: "move-task", error: "invalidInput" },
  });
});

it("answers a finished action with ok and ignores its result", async () => {
  const outcome = await outcomeOf(
    await runTaskAction("restore-task", async () => ({ id: "hidden" })),
  );

  expect(outcome).toMatchObject({
    status: 200,
    body: { ok: true, intent: "restore-task" },
  });
});

it("redirects after an action that removed the page", async () => {
  const outcome = await outcomeOf(
    await runTaskActionThenRedirect(
      "delete-task",
      async () => undefined,
      "/aufgaben",
    ),
  );

  expect(outcome).toMatchObject({ status: 302, location: "/aufgaben" });
});

it("names the key of the ticket the action changed", async () => {
  const outcome = await outcomeOf(
    await runTicketAction("update-task", async () => ({ key: "SYN-7" })),
  );

  expect(outcome.body).toEqual({
    ok: true,
    intent: "update-task",
    key: "SYN-7",
  });
});

it.each([
  ["a denied access", new WorkItemAccessDeniedError(), 403, "forbidden"],
  ["a missing ticket", new WorkItemNotFoundError(), 404, "notFound"],
  [
    "a concurrent change",
    new WorkItemConflictError("status"),
    409,
    "ticketConflict",
  ],
  [
    "a hierarchy rule",
    new WorkItemHierarchyError("epicSelfParent"),
    400,
    "epicSelfParent",
  ],
  [
    "a validation rule",
    new WorkItemValidationError("labelNameTaken"),
    400,
    "labelNameTaken",
  ],
  ["a GitHub refusal", new GitHubApiError(422, "x"), 422, "githubSyncFailed"],
  [
    "a GitHub server fault",
    new GitHubApiError(599, "x"),
    599,
    "githubSyncFailed",
  ],
  ["a GitHub redirect", new GitHubApiError(304, "x"), 502, "githubSyncFailed"],
  [
    "a GitHub network fault",
    new GitHubApiError(600, "x"),
    502,
    "githubSyncFailed",
  ],
])("maps %s to %i", async (caseName, error, status, code) => {
  const outcome = await outcomeOf(
    await runTaskAction("sync-github-task", async () => failWith(error)),
  );

  expect(outcome).toMatchObject({
    status,
    body: { ok: false, intent: "sync-github-task", error: code },
  });
});

it("maps the failure of a redirecting action", async () => {
  const outcome = await outcomeOf(
    await runTaskActionThenRedirect(
      "delete-task",
      async () => failWith(new WorkItemAccessDeniedError()),
      "/aufgaben",
    ),
  );

  expect(outcome).toMatchObject({
    status: 403,
    location: null,
    body: { ok: false, intent: "delete-task", error: "forbidden" },
  });
});

it("maps the failure of a ticket action", async () => {
  const outcome = await outcomeOf(
    await runTicketAction("move-task", async () =>
      failWith(new WorkItemNotFoundError()),
    ),
  );

  expect(outcome).toMatchObject({
    status: 404,
    body: { ok: false, intent: "move-task", error: "notFound" },
  });
});

it("rethrows a failure the client must not see", async () => {
  const failure = new Error("database closed");

  await expect(
    runTaskAction("restore-task", async () => failWith(failure)),
  ).rejects.toBe(failure);
  await expect(
    runTaskActionThenRedirect(
      "delete-task",
      async () => failWith(failure),
      "/",
    ),
  ).rejects.toBe(failure);
  await expect(
    runTicketAction("move-task", async () => failWith(failure)),
  ).rejects.toBe(failure);
});
