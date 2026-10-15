import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleUsersAction } from "@/app/lib/user-actions/user-actions.server";
import {
  EmailTakenError,
  LastAdministratorError,
  RoleAssignmentDeniedError,
} from "@/backend/error/UserErrors";

import { ACTOR, formOf, outcomeOf, servicesOf } from "./action-fixtures";

import type { ActionOutcome, FormFields } from "./action-fixtures";

const administration = {
  createUser: vi.fn(),
  setActive: vi.fn(),
  updateProfile: vi.fn(),
  assignRole: vi.fn(),
  resetPassword: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
});

async function submit(
  intent: string,
  fields: FormFields,
): Promise<ActionOutcome> {
  const formData = formOf({ intent, ...fields });

  return outcomeOf(
    await handleUsersAction(formData.get("intent"), {
      actor: ACTOR,
      formData,
      services: servicesOf({ administrationService: administration }),
    }),
  );
}

const NEW_USER = {
  firstName: " Anna ",
  lastName: "Muster",
  username: " anna ",
  email: " anna@example.invalid ",
  role: " role-1 ",
  department: ["dep-1", "dep-2"],
};

function nothingCalled(): void {
  for (const service of Object.values(administration)) {
    expect(service).not.toHaveBeenCalled();
  }
}

describe("create-user", () => {
  it("creates the account and hands over the temporary password once", async () => {
    administration.createUser.mockResolvedValue({ temporaryPassword: "t-pw" });

    const outcome = await submit("create-user", NEW_USER);

    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({
      intent: "create-user",
      ok: true,
      temporaryPassword: "t-pw",
    });
    expect(outcome.headers.get("Cache-Control")).toBe("no-store");
    expect(administration.createUser).toHaveBeenCalledExactlyOnceWith(
      ACTOR.id,
      {
        firstName: "Anna",
        lastName: "Muster",
        username: "anna",
        email: "anna@example.invalid",
        roleId: "role-1",
        isAdmin: false,
        departments: ["dep-1", "dep-2"],
      },
    );
  });

  it("grants administration only for the literal true", async () => {
    administration.createUser.mockResolvedValue({ temporaryPassword: "t-pw" });

    await submit("create-user", { ...NEW_USER, isAdmin: "true" });
    await submit("create-user", { ...NEW_USER, isAdmin: "on" });

    expect(administration.createUser.mock.calls[0]?.[1]).toMatchObject({
      isAdmin: true,
    });
    expect(administration.createUser.mock.calls[1]?.[1]).toMatchObject({
      isAdmin: false,
    });
  });

  it("stores no role and no email when the fields are blank", async () => {
    administration.createUser.mockResolvedValue({ temporaryPassword: "t-pw" });

    await submit("create-user", { ...NEW_USER, role: " ", email: "" });

    expect(administration.createUser.mock.calls[0]?.[1]).toMatchObject({
      roleId: null,
      email: null,
    });
  });

  it.each([
    ["a missing username", { username: "" }],
    ["a blank username", { username: "   " }],
    ["a missing first name", { firstName: "" }],
    ["a missing last name", { lastName: " " }],
    ["a malformed email", { email: "not-an-address" }],
    ["a too long email", { email: `${"a".repeat(320)}@x.invalid` }],
    ["a too long name", { firstName: "n".repeat(201) }],
    ["a too long username", { username: "u".repeat(201) }],
  ])("rejects %s before any service is asked", async (caseName, change) => {
    const outcome = await submit("create-user", { ...NEW_USER, ...change });

    expect(outcome.status).toBe(400);
    expect(outcome.body).toEqual({
      ok: false,
      intent: "create-user",
      error: "invalidInput",
    });
    nothingCalled();
  });

  it("ignores file entries among the departments", async () => {
    administration.createUser.mockResolvedValue({ temporaryPassword: "t-pw" });
    const formData = formOf({ intent: "create-user", ...NEW_USER });
    formData.append("department", new File(["x"], "x.txt"));

    await handleUsersAction("create-user", {
      actor: ACTOR,
      formData,
      services: servicesOf({ administrationService: administration }),
    });

    expect(administration.createUser.mock.calls[0]?.[1]).toMatchObject({
      departments: ["dep-1", "dep-2"],
    });
  });

  it("reports a taken username without leaking it", async () => {
    administration.createUser.mockRejectedValue(
      new EmailTakenError("anna@example.invalid"),
    );

    const outcome = await submit("create-user", NEW_USER);

    expect(outcome.status).toBe(409);
    expect(outcome.body).toEqual({
      ok: false,
      intent: "create-user",
      error: "emailTaken",
    });
  });

  it("does not swallow an unexpected failure", async () => {
    administration.createUser.mockRejectedValue(new Error("disk full"));

    await expect(submit("create-user", NEW_USER)).rejects.toThrow("disk full");
  });
});

describe("set-active", () => {
  it.each([
    ["true", true],
    ["false", false],
  ])("passes isActive=%s on", async (value, expected) => {
    administration.setActive.mockResolvedValue(undefined);

    const outcome = await submit("set-active", {
      userId: "u1",
      isActive: value,
    });

    expect(outcome.body).toEqual({ intent: "set-active", ok: true });
    expect(administration.setActive).toHaveBeenCalledWith(
      ACTOR.id,
      "u1",
      expected,
    );
  });

  it.each([
    ["a missing flag", { userId: "u1" }],
    ["an unknown flag", { userId: "u1", isActive: "yes" }],
    ["an upper-case flag", { userId: "u1", isActive: "TRUE" }],
    ["a missing user", { isActive: "true" }],
    ["a file as user", { userId: new File(["x"], "x"), isActive: "true" }],
  ])("rejects %s", async (caseName, fields) => {
    const outcome = await submit("set-active", fields);

    expect(outcome.status).toBe(400);
    nothingCalled();
  });

  it("refuses to deactivate the last administrator", async () => {
    administration.setActive.mockRejectedValue(new LastAdministratorError());

    const outcome = await submit("set-active", {
      userId: "u1",
      isActive: "false",
    });

    expect(outcome.status).toBe(409);
    expect(outcome.body).toMatchObject({ error: "lastAdministrator" });
  });
});

describe("update-user", () => {
  const fields = {
    userId: "u1",
    firstName: "Anna",
    lastName: "",
    username: "anna",
    email: "",
  };

  it("saves the profile of the named user", async () => {
    administration.updateProfile.mockResolvedValue(undefined);

    const outcome = await submit("update-user", fields);

    expect(outcome.body).toEqual({ intent: "update-user", ok: true });
    expect(administration.updateProfile).toHaveBeenCalledWith(ACTOR.id, "u1", {
      firstName: "Anna",
      lastName: "",
      username: "anna",
      email: null,
      userId: "u1",
    });
  });

  it.each([
    ["no user", { userId: "" }],
    ["a blank user", { userId: "  " }],
    ["no username", { username: "" }],
    ["no name at all", { firstName: "", lastName: "" }],
    ["a malformed email", { email: "a@b" }],
  ])("rejects %s", async (caseName, change) => {
    const outcome = await submit("update-user", { ...fields, ...change });

    expect(outcome.status).toBe(400);
    expect(outcome.body).toMatchObject({ intent: "update-user" });
    nothingCalled();
  });
});

describe("set-role", () => {
  it("assigns the role", async () => {
    administration.assignRole.mockResolvedValue(undefined);

    const outcome = await submit("set-role", { userId: "u1", role: "r1" });

    expect(outcome.body).toEqual({ intent: "set-role", ok: true });
    expect(administration.assignRole).toHaveBeenCalledWith(
      ACTOR.id,
      "u1",
      "r1",
    );
  });

  it.each([
    ["no role", { userId: "u1" }],
    ["a blank role", { userId: "u1", role: "  " }],
    ["no user", { role: "r1" }],
  ])("rejects %s", async (caseName, fields) => {
    const outcome = await submit("set-role", fields);

    expect(outcome.status).toBe(400);
    nothingCalled();
  });

  it("answers forbidden for a role beyond the actor's reach", async () => {
    administration.assignRole.mockRejectedValue(
      new RoleAssignmentDeniedError(),
    );

    const outcome = await submit("set-role", { userId: "u1", role: "r1" });

    expect(outcome.status).toBe(403);
    expect(outcome.body).toEqual({
      ok: false,
      intent: "set-role",
      error: "forbidden",
    });
  });

  it("names the demotion of the last administrator", async () => {
    administration.assignRole.mockRejectedValue(new LastAdministratorError());

    const outcome = await submit("set-role", { userId: "u1", role: "r1" });

    expect(outcome.body).toMatchObject({ error: "demoteLastAdministrator" });
  });
});

describe("reset-password", () => {
  it("returns the temporary password with the user, uncached", async () => {
    administration.resetPassword.mockResolvedValue({ temporaryPassword: "t" });

    const outcome = await submit("reset-password", { userId: "u1" });

    expect(outcome.body).toEqual({
      intent: "reset-password",
      ok: true,
      temporaryPassword: "t",
      userId: "u1",
    });
    expect(outcome.headers.get("Cache-Control")).toBe("no-store");
    expect(administration.resetPassword).toHaveBeenCalledWith(ACTOR.id, "u1");
  });

  it("requires a user", async () => {
    const outcome = await submit("reset-password", { userId: " " });

    expect(outcome.status).toBe(400);
    nothingCalled();
  });
});

describe("handleUsersAction dispatch", () => {
  it.each(["", "unknown", "constructor", "__proto__", "toString", "SET-ROLE"])(
    "answers the intent %j like an invalid create form",
    async (intent) => {
      const outcome = await submit(intent, { userId: "u1" });

      expect(outcome.status).toBe(400);
      expect(outcome.body).toEqual({
        ok: false,
        intent: "create-user",
        error: "invalidInput",
      });
      nothingCalled();
    },
  );

  it("treats a missing or file intent as invalid", async () => {
    const services = servicesOf({ administrationService: administration });
    const formData = formOf({ userId: "u1" });
    const context = { actor: ACTOR, formData, services };

    for (const intent of [null, new File(["set-role"], "set-role")]) {
      const outcome = await outcomeOf(await handleUsersAction(intent, context));

      expect(outcome.status).toBe(400);
    }
    nothingCalled();
  });
});
