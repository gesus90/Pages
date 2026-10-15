import { describe, expect, it } from "vitest";

import { toActionError } from "@/app/lib/user-actions/user-action-support.server";
import {
  AdministrationError,
  AgentScopeInUseError,
} from "@/backend/error/AdministrationError";
import {
  EmailTakenError,
  LastAdministratorError,
  RoleAssignmentDeniedError,
  UserManagementDeniedError,
  UserNotFoundError,
  UsernameTakenError,
} from "@/backend/error/UserErrors";

import { outcomeOf } from "./action-fixtures";

import type { AdministrationErrorCode } from "@/backend/error/AdministrationError";

const ADMINISTRATION_CASES: ReadonlyArray<
  [AdministrationErrorCode, string, number]
> = [
  ["forbidden", "forbidden", 403],
  ["invalidInput", "invalidInput", 400],
  ["notFound", "userNotFound", 404],
  ["inUse", "inUse", 409],
  ["agentInUse", "agentInUse", 409],
  ["lastAdministrator", "lastAdministrator", 409],
  ["lastMembership", "lastMembership", 409],
];

describe("toActionError for administration failures", () => {
  it.each(ADMINISTRATION_CASES)(
    "maps %s to %s with status %i",
    async (code, error, status) => {
      const outcome = await outcomeOf(
        toActionError(new AdministrationError(code), "delete-role"),
      );

      expect(outcome.status).toBe(status);
      expect(outcome.body).toEqual({ ok: false, intent: "delete-role", error });
    },
  );

  it("names the agents that block a deletion", async () => {
    const outcome = await outcomeOf(
      toActionError(
        new AgentScopeInUseError(["Agent A", "Agent B"]),
        "delete-department",
      ),
    );

    expect(outcome.status).toBe(409);
    expect(outcome.body).toEqual({
      ok: false,
      intent: "delete-department",
      error: "agentInUse",
      agents: ["Agent A", "Agent B"],
    });
  });
});

describe("toActionError for user failures", () => {
  it("maps a missing user to 404", async () => {
    const outcome = await outcomeOf(
      toActionError(new UserNotFoundError(), "set-active"),
    );

    expect(outcome.status).toBe(404);
    expect(outcome.body).toMatchObject({ error: "userNotFound" });
  });

  it("tells demoting the last administrator from other last-admin failures", async () => {
    const demoted = await outcomeOf(
      toActionError(new LastAdministratorError(), "set-role"),
    );
    const deactivated = await outcomeOf(
      toActionError(new LastAdministratorError(), "set-active"),
    );

    expect(demoted.status).toBe(409);
    expect(demoted.body).toMatchObject({ error: "demoteLastAdministrator" });
    expect(deactivated.body).toMatchObject({ error: "lastAdministrator" });
  });

  it.each([new RoleAssignmentDeniedError(), new UserManagementDeniedError()])(
    "maps %s to forbidden",
    async (error) => {
      const outcome = await outcomeOf(toActionError(error, "set-role"));

      expect(outcome.status).toBe(403);
      expect(outcome.body).toMatchObject({ ok: false, error: "forbidden" });
    },
  );

  it("maps taken names and addresses to conflicts", async () => {
    const username = await outcomeOf(
      toActionError(new UsernameTakenError("anna"), "create-user"),
    );
    const email = await outcomeOf(
      toActionError(new EmailTakenError("a@b.invalid"), "update-user"),
    );

    expect(username.status).toBe(409);
    expect(username.body).toMatchObject({ error: "usernameTaken" });
    expect(email.status).toBe(409);
    expect(email.body).toMatchObject({ error: "emailTaken" });
  });

  it("does not echo what it cannot explain", async () => {
    const outcome = await outcomeOf(
      toActionError(new UsernameTakenError("anna"), "create-user"),
    );

    expect(JSON.stringify(outcome.body)).not.toContain("anna");
  });

  it("rethrows an unknown failure instead of hiding it", () => {
    const failure = new Error("database is gone");

    expect(() => toActionError(failure, "create-user")).toThrow(failure);
    expect(() => toActionError("text", "create-user")).toThrow();
  });
});
