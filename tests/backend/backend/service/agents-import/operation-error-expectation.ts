import { expect } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";

import type { AgentLimitDetails } from "@/definition/PagesAgentOperations";

/** Runs a synchronous call and returns what it threw, so a test can name it. */
function capture(run: () => unknown): unknown {
  try {
    run();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

/** Expects the call to be refused as `INVALID_REQUEST`, which is the status 400 of the wire. */
export function expectInvalidRequest(run: () => unknown): void {
  const thrown = capture(run);
  expect(thrown).toBeInstanceOf(AgentOperationError);
  expect(thrown).toMatchObject({ code: "INVALID_REQUEST", status: 400 });
}

/** Expects the call to be refused as too large, naming the limit that was hit. */
export function expectTooLarge(
  run: () => unknown,
  details: AgentLimitDetails,
): void {
  const thrown = capture(run);
  expect(thrown).toBeInstanceOf(AgentOperationError);
  expect(thrown).toMatchObject({
    code: "PAYLOAD_TOO_LARGE",
    status: 413,
    details,
  });
}
