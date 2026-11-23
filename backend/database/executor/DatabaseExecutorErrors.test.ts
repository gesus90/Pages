import { expect, it } from "vitest";

import {
  DatabaseOutcomeUnknownError,
  DatabaseOverloadedError,
  DatabaseUnavailableError,
} from "@/backend/database/executor/DatabaseExecutorErrors";

it.each(["overloaded", "queue_timeout", "aborted"] as const)(
  "describes an unstarted %s job",
  (reason) => {
    const error = new DatabaseOverloadedError(reason);
    expect(error.failure).toBe(reason);
    expect(error.notStarted).toBe(true);
    expect(error.retryAfterSeconds).toBe(5);
    expect(error.name).toBe("DatabaseOverloadedError");
    expect(error.message).toContain(
      reason === "aborted" ? "cancelled" : "busy",
    );
  },
);

it("describes an unavailable database", () => {
  const error = new DatabaseUnavailableError();
  expect(error.failure).toBe("unavailable");
  expect(error.notStarted).toBe(true);
  expect(error.retryAfterSeconds).toBe(10);
  expect(error.message).toBe("The database is not available.");
  expect(new DatabaseUnavailableError("down").message).toBe("down");
});

it("describes an unknown outcome", () => {
  const error = new DatabaseOutcomeUnknownError();
  expect(error.failure).toBe("outcome_unknown");
  expect(error.notStarted).toBe(false);
  expect(error.retryAfterSeconds).toBe(10);
  expect(error.name).toBe("DatabaseOutcomeUnknownError");
});
