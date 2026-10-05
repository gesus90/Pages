import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/auth.server", () => ({
  authenticatedUserContext: {},
  getAuthenticatedUser: vi.fn(),
  parseCredentials: vi.fn(),
  requireAuthenticatedUser: vi.fn(),
  requirePermission: vi.fn(),
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import { getApplicationServices } from "@/app/lib/services.server";
import { sessionCookie } from "@/app/lib/session.server";
import { action } from "@/app/routes/settings";
import { ROLE } from "@/definition/Role";

import { createUser } from "../helpers/factories";
import {
  EmailTakenError,
  LastAdministratorError,
  RoleAssignmentDeniedError,
  UserManagementDeniedError,
  UsernameTakenError,
} from "@/backend/error/UserErrors";

import type { User } from "@/definition/User";

const mockedServices = vi.mocked(getApplicationServices);

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];

interface ActionResult {
  readonly data: Record<string, unknown>;
  readonly init?: { readonly status?: number };
}

function createContext(user: User | null): { get: ReturnType<typeof vi.fn> } {
  return { get: vi.fn().mockReturnValue(user) };
}

function createServices(overrides: Record<string, unknown> = {}): {
  authService: { changePassword: ReturnType<typeof vi.fn> };
  sessionService: {
    revokeOtherSessions: ReturnType<typeof vi.fn>;
    revokeSessionById: ReturnType<typeof vi.fn>;
  };
  userService: {
    updateOwnAvatar: ReturnType<typeof vi.fn>;
    updateOwnProfile: ReturnType<typeof vi.fn>;
  };
} {
  const services = {
    authService: { changePassword: vi.fn().mockResolvedValue("success") },
    sessionService: {
      revokeOtherSessions: vi.fn().mockResolvedValue(undefined),
      revokeSessionById: vi.fn().mockResolvedValue(true),
    },
    userService: {
      updateOwnAvatar: vi.fn().mockResolvedValue(undefined),
      updateOwnProfile: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };

  mockedServices.mockResolvedValue(
    services as unknown as Awaited<ReturnType<typeof mockedServices>>,
  );

  return services as ReturnType<typeof createServices>;
}

async function submit(
  entries: Record<string, string | File>,
  user: User | null = createUser(),
  cookie?: string,
): Promise<ActionResult> {
  const body = new FormData();

  for (const [key, value] of Object.entries(entries)) {
    body.set(key, value);
  }

  const headers = new Headers();

  if (cookie) {
    headers.set("Cookie", cookie);
  }

  return (await action({
    context: createContext(user),
    params: {},
    request: new Request("http://pages.invalid/settings", {
      body,
      headers,
      method: "POST",
    }),
  } as unknown as Parameters<typeof action>[0])) as unknown as ActionResult;
}

function createImage(type = "image/png", bytes = PNG_BYTES): File {
  return new File([new Uint8Array(bytes)], "me.png", { type });
}

const PROFILE_ENTRIES = {
  displayName: "  Root  ",
  email: " root@example.invalid ",
  intent: "update-profile",
  role: "admin",
  username: "@root",
};

describe("settings route: update-profile", () => {
  beforeEach(() => {
    mockedServices.mockReset();
  });

  it("stores a trimmed profile and drops the @ of the username", async () => {
    const services = createServices();
    const user = createUser();

    const result = await submit(PROFILE_ENTRIES, user);

    expect(result.data).toEqual({ intent: "update-profile", ok: true });
    expect(services.userService.updateOwnProfile).toHaveBeenCalledWith(user, {
      displayName: "Root",
      email: "root@example.invalid",
      role: "admin",
      username: "root",
    });
    expect(services.userService.updateOwnAvatar).not.toHaveBeenCalled();
  });

  it("stores an uploaded avatar before the profile", async () => {
    const services = createServices();

    await submit({ ...PROFILE_ENTRIES, avatar: createImage() });

    expect(services.userService.updateOwnAvatar).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        avatarType: "image",
        filename: "me.png",
        mimeType: "image/png",
      }),
    );
  });

  it("accepts an empty email address as no email", async () => {
    const services = createServices();

    await submit({ ...PROFILE_ENTRIES, email: "  " });

    expect(services.userService.updateOwnProfile).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: null }),
    );
  });

  it.each([
    ["a missing display name", { displayName: "   " }],
    ["a missing username", { username: "@" }],
    ["an invalid role", { role: "owner" }],
    ["an invalid email address", { email: "not-an-email" }],
    ["a too long display name", { displayName: "x".repeat(201) }],
  ])("rejects %s", async (_label, override) => {
    const services = createServices();

    const result = await submit({ ...PROFILE_ENTRIES, ...override });

    expect(result.init?.status).toBe(400);
    expect(result.data).toMatchObject({ error: "invalidInput", ok: false });
    expect(services.userService.updateOwnProfile).not.toHaveBeenCalled();
  });

  it("rejects an avatar that is not a supported image", async () => {
    const services = createServices();

    const result = await submit({
      ...PROFILE_ENTRIES,
      avatar: createImage("image/svg+xml"),
    });

    expect(result.data).toMatchObject({ error: "invalidAvatar" });
    expect(services.userService.updateOwnAvatar).not.toHaveBeenCalled();
  });

  it.each([
    [new UsernameTakenError("root"), "usernameTaken", 400],
    [new EmailTakenError("root@example.invalid"), "emailTaken", 400],
    [new LastAdministratorError(), "lastAdministrator", 409],
    [new UserManagementDeniedError(), "forbidden", 403],
    [new RoleAssignmentDeniedError(), "forbidden", 403],
    [new Error("Database unavailable"), "general", 400],
  ])("maps %s to %s", async (failure, error, status) => {
    createServices({
      userService: {
        updateOwnAvatar: vi.fn(),
        updateOwnProfile: vi.fn().mockRejectedValue(failure),
      },
    });

    const result = await submit(PROFILE_ENTRIES);

    expect(result.init?.status).toBe(status);
    expect(result.data).toMatchObject({ error, ok: false });
  });
});

describe("settings route: update-avatar", () => {
  beforeEach(() => {
    mockedServices.mockReset();
  });

  it("lets every user replace their own avatar", async () => {
    const services = createServices();

    const result = await submit(
      { avatar: createImage(), intent: "update-avatar" },
      createUser({ role: ROLE.EMPLOYEE }),
    );

    expect(result.data).toEqual({ intent: "update-avatar", ok: true });
    expect(services.userService.updateOwnAvatar).toHaveBeenCalledTimes(1);
  });

  it("reports a missing file as invalid input", async () => {
    createServices();

    const result = await submit({ intent: "update-avatar" });

    expect(result.data).toMatchObject({ error: "invalidInput", ok: false });
    expect(result.init?.status).toBe(400);
  });

  it.each([
    ["an unsupported type", createImage("image/gif")],
    [
      "wrong magic bytes",
      createImage("image/png", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    ],
    ["a tiny file", createImage("image/png", [0x89, 0x50])],
    [
      "a file over five megabytes",
      createImage("image/png", [
        ...PNG_BYTES,
        ...new Array<number>(5 * 1024 * 1024).fill(0),
      ]),
    ],
  ])("rejects %s", async (_label, file) => {
    const services = createServices();

    const result = await submit({ avatar: file, intent: "update-avatar" });

    expect(result.data).toMatchObject({ error: "invalidAvatar", ok: false });
    expect(services.userService.updateOwnAvatar).not.toHaveBeenCalled();
  });

  it("accepts JPEG and WebP images by their magic bytes", async () => {
    const services = createServices();
    const jpeg = createImage(
      "image/jpeg",
      [0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0],
    );
    const webp = createImage(
      "image/webp",
      [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
    );

    await submit({ avatar: jpeg, intent: "update-avatar" });
    await submit({ avatar: webp, intent: "update-avatar" });

    expect(services.userService.updateOwnAvatar).toHaveBeenCalledTimes(2);
  });

  it("strips unsafe characters from the stored file name", async () => {
    const services = createServices();
    const file = new File([new Uint8Array(PNG_BYTES)], "../my pic<1>.png", {
      type: "image/png",
    });

    await submit({ avatar: file, intent: "update-avatar" });

    expect(services.userService.updateOwnAvatar).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ filename: "..mypic1.png" }),
    );
  });

  it("reports storage failures", async () => {
    createServices({
      userService: {
        updateOwnAvatar: vi.fn().mockRejectedValue(new Error("Disk full")),
        updateOwnProfile: vi.fn(),
      },
    });

    const result = await submit({
      avatar: createImage(),
      intent: "update-avatar",
    });

    expect(result.data).toMatchObject({ error: "general", ok: false });
  });
});

describe("settings route: change-password", () => {
  beforeEach(() => {
    mockedServices.mockReset();
  });

  const PASSWORDS = {
    currentPassword: "old-password",
    intent: "change-password",
    newPassword: "new-password-1",
    passwordConfirmation: "new-password-1",
  };

  it("changes the password of the signed-in user", async () => {
    const services = createServices();
    const cookie = (await sessionCookie.serialize("browser-token")).split(
      ";",
    )[0];

    const result = await submit(PASSWORDS, createUser(), cookie);

    expect(result.data).toEqual({
      intent: "change-password",
      outcome: "success",
    });
    expect(services.authService.changePassword).toHaveBeenCalledWith(
      "admin",
      "old-password",
      "new-password-1",
      "browser-token",
    );
  });

  it.each([
    ["too short", { newPassword: "short", passwordConfirmation: "short" }],
    ["mismatched", { passwordConfirmation: "something-else" }],
  ])("rejects a %s new password", async (label, override) => {
    const services = createServices();

    const result = await submit({ ...PASSWORDS, ...override });

    expect(result.init?.status).toBe(400);
    expect(result.data.outcome).toBe(
      label === "too short" ? "tooShort" : "mismatch",
    );
    expect(services.authService.changePassword).not.toHaveBeenCalled();
  });

  it("rejects missing fields and absurdly long passwords", async () => {
    const services = createServices();

    const missing = await submit({ intent: "change-password" });
    const tooLong = await submit({
      ...PASSWORDS,
      newPassword: "x".repeat(1000),
      passwordConfirmation: "x".repeat(1000),
    });

    expect(missing.data.outcome).toBe("invalidInput");
    expect(tooLong.data.outcome).toBe("invalidInput");
    expect(services.authService.changePassword).not.toHaveBeenCalled();
  });

  it.each(["invalidCurrent", "unchanged"])(
    "passes the %s outcome of the service on",
    async (outcome) => {
      createServices({
        authService: { changePassword: vi.fn().mockResolvedValue(outcome) },
      });

      const result = await submit(PASSWORDS);

      expect(result.init?.status).toBe(400);
      expect(result.data).toEqual({ intent: "change-password", outcome });
    },
  );
});

describe("settings route: session management", () => {
  beforeEach(() => {
    mockedServices.mockReset();
  });

  it("revokes one session using the current browser session as guard", async () => {
    const services = createServices();
    const cookie = (await sessionCookie.serialize("browser-token")).split(
      ";",
    )[0];

    const result = await submit(
      { intent: "revoke-session", sessionId: "session-2" },
      createUser(),
      cookie,
    );

    expect(result.data).toEqual({ intent: "revoke-session" });
    expect(services.sessionService.revokeSessionById).toHaveBeenCalledWith(
      "user-1",
      "session-2",
      "browser-token",
    );
  });

  it("rejects a missing session identifier", async () => {
    createServices();

    const failure = await submit({ intent: "revoke-session" }).catch(
      (error: unknown) => error,
    );

    expect((failure as Response).status).toBe(400);
  });

  it("rejects sessions that could not be revoked", async () => {
    createServices({
      sessionService: {
        revokeOtherSessions: vi.fn(),
        revokeSessionById: vi.fn().mockResolvedValue(false),
      },
    });

    const failure = await submit({
      intent: "revoke-session",
      sessionId: "session-1",
    }).catch((error: unknown) => error);

    expect((failure as Response).status).toBe(400);
  });

  it("revokes every other session", async () => {
    const services = createServices();
    const cookie = (await sessionCookie.serialize("browser-token")).split(
      ";",
    )[0];

    const result = await submit(
      { intent: "revoke-other-sessions" },
      createUser(),
      cookie,
    );

    expect(result.data).toEqual({ intent: "revoke-other-sessions" });
    expect(services.sessionService.revokeOtherSessions).toHaveBeenCalledWith(
      "user-1",
      "browser-token",
    );
  });
});
