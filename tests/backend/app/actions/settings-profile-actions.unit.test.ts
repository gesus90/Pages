import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  handleUpdateAvatar,
  handleUpdateProfile,
} from "@/app/lib/settings-actions/settings-profile-actions.server";
import { AdministrationError } from "@/backend/error/AdministrationError";
import {
  EmailTakenError,
  LastAdministratorError,
  UserManagementDeniedError,
  UsernameTakenError,
} from "@/backend/error/UserErrors";

import {
  accountFixture,
  administratorFixture,
} from "../../backend/auth/account-fixture";
import {
  ACTOR,
  callArgument,
  outcomeOf,
  settingsContext,
  thrownStatus,
} from "./action-fixtures";
import { pngBytes, uploadedFile } from "./image-fixtures";

import type { ActionOutcome, FormFields } from "./action-fixtures";

const services = {
  administrationService: {
    getContext: vi.fn(),
    updateOwnDisplayProfile: vi.fn(),
  },
  userService: { updateOwnAvatar: vi.fn() },
};

const PROFILE = { displayName: " Anna Muster ", username: "@anna", email: "" };

beforeEach(() => {
  vi.resetAllMocks();
  services.administrationService.getContext.mockResolvedValue(
    administratorFixture({ userId: ACTOR.id }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

async function profile(fields: FormFields): Promise<ActionOutcome> {
  return outcomeOf(
    await handleUpdateProfile(settingsContext(services, fields)),
  );
}

describe("handleUpdateProfile authorization", () => {
  it.each([
    ["an employee", accountFixture({ userId: ACTOR.id })],
    ["an inactive administrator", administratorFixture({ isActive: false })],
    [
      "an administrator in the role mode",
      accountFixture({ userId: ACTOR.id, isAdmin: true, mode: "role" }),
    ],
  ])(
    "answers 403 for %s without touching anything",
    async (caseName, account) => {
      services.administrationService.getContext.mockResolvedValue(account);

      const status = await thrownStatus(
        handleUpdateProfile(
          settingsContext(services, {
            ...PROFILE,
            avatar: uploadedFile(pngBytes(), "a.png", "image/png"),
          }),
        ),
      );

      expect(status).toBe(403);
      expect(services.userService.updateOwnAvatar).not.toHaveBeenCalled();
      expect(
        services.administrationService.updateOwnDisplayProfile,
      ).not.toHaveBeenCalled();
    },
  );

  it("reads the account facts of the signed-in user", async () => {
    await profile(PROFILE);

    expect(services.administrationService.getContext).toHaveBeenCalledWith(
      ACTOR.id,
    );
  });
});

describe("handleUpdateProfile input", () => {
  it("saves the cleaned values", async () => {
    const outcome = await profile({ ...PROFILE, email: " a@example.invalid " });

    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ intent: "update-profile", ok: true });
    expect(
      services.administrationService.updateOwnDisplayProfile,
    ).toHaveBeenCalledWith(ACTOR.id, {
      displayName: "Anna Muster",
      username: "anna",
      email: "a@example.invalid",
    });
  });

  it("stores no email for a blank field", async () => {
    await profile({ ...PROFILE, email: "   " });

    expect(
      callArgument(
        services.administrationService.updateOwnDisplayProfile,
        0,
        1,
      ),
    ).toMatchObject({ email: null });
  });

  it.each([
    ["no display name", { displayName: "" }],
    ["a blank display name", { displayName: "  " }],
    ["no username", { username: "" }],
    ["only an at sign as username", { username: "@" }],
    ["a too long display name", { displayName: "n".repeat(201) }],
    ["a too long username", { username: "u".repeat(201) }],
    ["a malformed email", { email: "anna@" }],
    ["a too long email", { email: `${"a".repeat(320)}@x.invalid` }],
    ["a file as display name", { displayName: new File(["x"], "x") }],
  ])("answers 400 invalidInput for %s", async (caseName, change) => {
    const outcome = await profile({ ...PROFILE, ...change });

    expect(outcome.status).toBe(400);
    expect(outcome.body).toEqual({
      intent: "update-profile",
      ok: false,
      error: "invalidInput",
    });
    expect(
      services.administrationService.updateOwnDisplayProfile,
    ).not.toHaveBeenCalled();
  });
});

describe("handleUpdateProfile avatar", () => {
  it("rejects an invalid avatar before anything is saved", async () => {
    const lying = uploadedFile(pngBytes(), "a.png", "image/jpeg");

    const outcome = await profile({ ...PROFILE, avatar: lying });

    expect(outcome.status).toBe(400);
    expect(outcome.body).toMatchObject({ error: "invalidAvatar" });
    expect(services.userService.updateOwnAvatar).not.toHaveBeenCalled();
    expect(
      services.administrationService.updateOwnDisplayProfile,
    ).not.toHaveBeenCalled();
  });

  it("stores a valid avatar with a cache-busting address", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T03:04:05Z"));
    const avatar = uploadedFile(pngBytes(), "me.png", "image/png");

    const outcome = await profile({ ...PROFILE, avatar });

    expect(outcome.status).toBe(200);
    expect(services.userService.updateOwnAvatar).toHaveBeenCalledWith(
      ACTOR.id,
      expect.objectContaining({
        avatarImageUrl: `/users/${ACTOR.id}/avatar?v=${Date.now()}`,
        avatarType: "image",
        filename: "me.png",
        mimeType: "image/png",
      }),
    );
  });

  it("keeps the avatar when the form sends none", async () => {
    await profile(PROFILE);

    expect(services.userService.updateOwnAvatar).not.toHaveBeenCalled();
  });
});

describe("handleUpdateProfile failures", () => {
  it.each([
    [new UsernameTakenError("anna"), "usernameTaken", 400],
    [new EmailTakenError("a@example.invalid"), "emailTaken", 400],
    [new LastAdministratorError(), "lastAdministrator", 409],
    [new UserManagementDeniedError(), "forbidden", 403],
    [new AdministrationError("forbidden"), "forbidden", 403],
    [new AdministrationError("invalidInput"), "general", 400],
    [new Error("database is gone"), "general", 400],
  ])("maps %s to %s", async (failure, error, status) => {
    services.administrationService.updateOwnDisplayProfile.mockRejectedValue(
      failure,
    );

    const outcome = await profile(PROFILE);

    expect(outcome.status).toBe(status);
    expect(outcome.body).toEqual({
      intent: "update-profile",
      ok: false,
      error,
    });
  });
});

describe("handleUpdateAvatar", () => {
  async function avatar(fields: FormFields): Promise<ActionOutcome> {
    return outcomeOf(
      await handleUpdateAvatar(settingsContext(services, fields)),
    );
  }

  it("is open to every signed-in user and checks no account facts", async () => {
    const outcome = await avatar({
      avatar: uploadedFile(pngBytes(), "me.png", "image/png"),
    });

    expect(outcome.body).toEqual({ intent: "update-avatar", ok: true });
    expect(services.administrationService.getContext).not.toHaveBeenCalled();
    expect(services.userService.updateOwnAvatar).toHaveBeenCalledWith(
      ACTOR.id,
      expect.objectContaining({ mimeType: "image/png", avatarType: "image" }),
    );
  });

  it("reports a missing file as invalid input", async () => {
    const outcome = await avatar({});

    expect(outcome.status).toBe(400);
    expect(outcome.body).toEqual({
      intent: "update-avatar",
      ok: false,
      error: "invalidInput",
    });
  });

  it("reports an unusable image as invalid avatar", async () => {
    const outcome = await avatar({
      avatar: uploadedFile(pngBytes(), "me.gif", "image/gif"),
    });

    expect(outcome.status).toBe(400);
    expect(outcome.body).toMatchObject({ error: "invalidAvatar" });
    expect(services.userService.updateOwnAvatar).not.toHaveBeenCalled();
  });

  it("reports a storage failure as general", async () => {
    services.userService.updateOwnAvatar.mockRejectedValue(new Error("full"));

    const outcome = await avatar({
      avatar: uploadedFile(pngBytes(), "me.png", "image/png"),
    });

    expect(outcome.status).toBe(400);
    expect(outcome.body).toEqual({
      intent: "update-avatar",
      ok: false,
      error: "general",
    });
  });
});
