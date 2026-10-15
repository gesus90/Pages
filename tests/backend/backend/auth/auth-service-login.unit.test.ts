import { describe, expect, it, vi } from "vitest";

import { TooManyLoginAttemptsError } from "@/backend/auth/LoginThrottle";

import {
  ADDRESS_FAILURE_LIMIT,
  AuthWorld,
  THROTTLE_WINDOW_MS,
  USERNAME_FAILURE_LIMIT,
} from "./auth-service-world";

const PASSWORD = "correct horse";

function worldWithAnna(
  options: { readonly isActive?: boolean } = {},
): AuthWorld {
  const world = new AuthWorld();
  world.sessionWorld.addPerson({
    userId: "anna",
    username: "anna",
    password: PASSWORD,
    isActive: options.isActive ?? true,
  });

  return world;
}

async function failTimes(
  world: AuthWorld,
  count: number,
  username = "anna",
  address: string | null = null,
): Promise<void> {
  for (let attempt = 0; attempt < count; attempt += 1) {
    await world.service.login(username, "wrong", null, address);
  }
}

describe("successful login", () => {
  it("returns the user together with a working session token", async () => {
    const world = worldWithAnna();

    const result = await world.service.login("anna", PASSWORD, "agent/1.0");

    expect(result?.user).toMatchObject({ id: "anna", username: "anna" });
    const token = result?.sessionToken ?? "";
    expect(token).not.toBe("");
    expect(world.sessionWorld.repository.sessions).toHaveLength(1);
    expect(world.sessionWorld.repository.sessions[0]).toMatchObject({
      userId: "anna",
      userAgent: "agent/1.0",
    });
    await expect(
      world.service.getAuthenticatedUser(token),
    ).resolves.toMatchObject({ id: "anna" });
  });

  it("forgets earlier failures of the username", async () => {
    const world = worldWithAnna();
    await failTimes(world, USERNAME_FAILURE_LIMIT - 1);

    await expect(world.service.login("anna", PASSWORD)).resolves.not.toBeNull();
    await failTimes(world, USERNAME_FAILURE_LIMIT - 1);

    await expect(world.service.login("anna", PASSWORD)).resolves.not.toBeNull();
  });
});

describe("rejected credentials", () => {
  it("rejects a wrong password without opening a session", async () => {
    const world = worldWithAnna();

    await expect(world.service.login("anna", "wrong")).resolves.toBeNull();
    expect(world.sessionWorld.repository.sessions).toHaveLength(0);
  });

  it("rejects an inactive account even with the right password", async () => {
    const world = worldWithAnna({ isActive: false });

    await expect(world.service.login("anna", PASSWORD)).resolves.toBeNull();
    expect(world.sessionWorld.repository.sessions).toHaveLength(0);
  });

  it("counts an inactive account like a wrong password", async () => {
    const world = worldWithAnna({ isActive: false });

    await failTimes(world, USERNAME_FAILURE_LIMIT);

    await expect(world.service.login("anna", PASSWORD)).rejects.toBeInstanceOf(
      TooManyLoginAttemptsError,
    );
  });

  it("answers an unknown user like a wrong password", async () => {
    const world = worldWithAnna();

    await expect(world.service.login("nobody", PASSWORD)).resolves.toBeNull();
    expect(world.sessionWorld.repository.sessions).toHaveLength(0);
  });

  it("verifies an unknown user against a decoy hash that is created once", async () => {
    const world = worldWithAnna();
    const hash = vi.spyOn(world.hasher, "hash");
    const verify = vi.spyOn(world.hasher, "verify");

    await world.service.login("nobody", PASSWORD);
    await world.service.login("someone", PASSWORD);

    expect(hash).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledTimes(2);
    const decoy = verify.mock.calls[0]?.[0];
    expect(decoy).toBe(verify.mock.calls[1]?.[0]);
    expect(decoy).not.toBe("");
  });

  it("does not create a decoy hash for a known user", async () => {
    const world = worldWithAnna();
    const hash = vi.spyOn(world.hasher, "hash");

    await world.service.login("anna", "wrong");

    expect(hash).not.toHaveBeenCalled();
  });

  it("retries the decoy hash after a failed attempt", async () => {
    const world = worldWithAnna();
    vi.spyOn(world.hasher, "hash").mockRejectedValueOnce(
      new Error("hashing unavailable"),
    );

    await expect(world.service.login("nobody", PASSWORD)).rejects.toThrow(
      "hashing unavailable",
    );
    await expect(world.service.login("nobody", PASSWORD)).resolves.toBeNull();
  });
});

describe("login throttle", () => {
  it("blocks the username at its limit even with the right password", async () => {
    const world = worldWithAnna();
    await failTimes(world, USERNAME_FAILURE_LIMIT);
    const lookup = vi.spyOn(
      world.sessionWorld.users,
      "findCredentialsByUsername",
    );

    await expect(world.service.login("anna", PASSWORD)).rejects.toMatchObject({
      name: "TooManyLoginAttemptsError",
      retryAfterSeconds: THROTTLE_WINDOW_MS / 1000,
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(world.sessionWorld.repository.sessions).toHaveLength(0);
  });

  it("lets the user sign in again after the window passed", async () => {
    const world = worldWithAnna();
    await failTimes(world, USERNAME_FAILURE_LIMIT);
    world.clock.now += THROTTLE_WINDOW_MS + 1;

    await expect(world.service.login("anna", PASSWORD)).resolves.not.toBeNull();
  });

  it("blocks unknown usernames the same way", async () => {
    const world = worldWithAnna();
    await failTimes(world, USERNAME_FAILURE_LIMIT, "nobody");

    await expect(
      world.service.login("nobody", PASSWORD),
    ).rejects.toBeInstanceOf(TooManyLoginAttemptsError);
  });

  it("blocks an address across different usernames", async () => {
    const world = worldWithAnna();
    for (let attempt = 0; attempt < ADDRESS_FAILURE_LIMIT; attempt += 1) {
      await world.service.login(`guess-${attempt}`, "x", null, "10.0.0.7");
    }

    await expect(
      world.service.login("anna", PASSWORD, null, "10.0.0.7"),
    ).rejects.toBeInstanceOf(TooManyLoginAttemptsError);
    await expect(
      world.service.login("anna", PASSWORD, null, "10.0.0.8"),
    ).resolves.not.toBeNull();
  });
});
