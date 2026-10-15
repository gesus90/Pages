import { expect } from "vitest";

import {
  AdministrationError,
  AgentScopeInUseError,
} from "@/backend/error/AdministrationError";

import type { AdministrationErrorCode } from "@/backend/error/AdministrationError";

/** Expects a rejected management operation with a stable error code. */
export async function expectRejection(
  work: Promise<unknown>,
  code: AdministrationErrorCode,
): Promise<void> {
  await expect(work).rejects.toBeInstanceOf(AdministrationError);
  await expect(work).rejects.toMatchObject({ code });
}

/** Expects the lock that keeps a group or department used by agents. */
export async function expectScopeLock(
  work: Promise<unknown>,
  names: readonly string[],
): Promise<void> {
  await expect(work).rejects.toBeInstanceOf(AgentScopeInUseError);
  await expect(work).rejects.toMatchObject({
    code: "agentInUse",
    agents: names,
  });
}
