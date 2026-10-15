import { describe, expect, it, vi } from "vitest";

import { AuthWorld } from "./auth-service-world";

const CURRENT = "current password";
const REPLACEMENT = "replacement password";

interface SignedInUser {
  readonly world: AuthWorld;
  readonly currentToken: string;
  readonly otherToken: string;
}

async function signedInTwice(
  options: { readonly mustChangePassword?: boolean } = {},
): Promise<SignedInUser> {
  const world = new AuthWorld();
  world.sessionWorld.addPerson({
    userId: "anna",
    username: "anna",
    password: CURRENT,
    mustChangePassword: options.mustChangePassword ?? false,
  });
  world.sessionWorld.addPerson({ userId: "ben", username: "ben" });
  const current = await world.service.login("anna", CURRENT);
  const other = await world.service.login("anna", CURRENT);

  return {
    world,
    currentToken: current?.sessionToken ?? "",
    otherToken: other?.sessionToken ?? "",
  };
}

describe("changePassword", () => {
  it("stores the new password and keeps only the requesting browser signed in", async () => {
    const { world, currentToken, otherToken } = await signedInTwice();
    const benToken = (await world.service.login("ben", "synthetic-password"))
      ?.sessionToken;

    const outcome = await world.service.changePassword(
      "anna",
      CURRENT,
      REPLACEMENT,
      currentToken,
    );

    expect(outcome).toBe("success");
    await expect(
      world.service.login("anna", REPLACEMENT),
    ).resolves.not.toBeNull();
    await expect(world.service.login("anna", CURRENT)).resolves.toBeNull();
    await expect(
      world.service.getAuthenticatedUser(currentToken),
    ).resolves.not.toBeNull();
    await expect(
      world.service.getAuthenticatedUser(otherToken),
    ).resolves.toBeNull();
    await expect(
      world.service.getAuthenticatedUser(benToken ?? null),
    ).resolves.not.toBeNull();
  });

  it("clears the obligation to replace the password", async () => {
    const { world, currentToken } = await signedInTwice({
      mustChangePassword: true,
    });
    expect(world.sessionWorld.accounts.user("anna").mustChangePassword).toBe(
      true,
    );

    await world.service.changePassword(
      "anna",
      CURRENT,
      REPLACEMENT,
      currentToken,
    );

    expect(world.sessionWorld.accounts.user("anna").mustChangePassword).toBe(
      false,
    );
  });

  it("stores only a hash of the new password", async () => {
    const { world, currentToken } = await signedInTwice();

    await world.service.changePassword(
      "anna",
      CURRENT,
      REPLACEMENT,
      currentToken,
    );

    const stored =
      world.sessionWorld.accounts.store.users.get("anna")?.passwordHash ?? "";
    expect(stored).toBe(`hashed:${REPLACEMENT}`);
    expect(stored).not.toBe(REPLACEMENT);
  });

  it("refuses a wrong current password without any change", async () => {
    const { world, currentToken } = await signedInTwice();
    const update = vi.spyOn(world.sessionWorld.users, "updatePasswordHash");

    const outcome = await world.service.changePassword(
      "anna",
      "not the password",
      REPLACEMENT,
      currentToken,
    );

    expect(outcome).toBe("invalidCurrent");
    expect(update).not.toHaveBeenCalled();
    expect(world.sessionWorld.repository.sessions).toHaveLength(2);
  });

  it("refuses an unknown username like a wrong password", async () => {
    const { world, currentToken } = await signedInTwice();

    await expect(
      world.service.changePassword(
        "nobody",
        CURRENT,
        REPLACEMENT,
        currentToken,
      ),
    ).resolves.toBe("invalidCurrent");
  });

  it("reports an unchanged password without touching sessions", async () => {
    const { world, currentToken } = await signedInTwice();
    const hash = vi.spyOn(world.hasher, "hash");
    const update = vi.spyOn(world.sessionWorld.users, "updatePasswordHash");

    const outcome = await world.service.changePassword(
      "anna",
      CURRENT,
      CURRENT,
      currentToken,
    );

    expect(outcome).toBe("unchanged");
    expect(hash).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(world.sessionWorld.repository.sessions).toHaveLength(2);
  });
});

describe("logout and session lookup", () => {
  it("ends only the session of the token", async () => {
    const { world, currentToken, otherToken } = await signedInTwice();

    await world.service.logout(currentToken);

    await expect(
      world.service.getAuthenticatedUser(currentToken),
    ).resolves.toBeNull();
    await expect(
      world.service.getAuthenticatedUser(otherToken),
    ).resolves.not.toBeNull();
  });

  it("accepts a logout without a token", async () => {
    const { world } = await signedInTwice();

    await world.service.logout(null);

    expect(world.sessionWorld.repository.sessions).toHaveLength(2);
  });

  it("resolves no user for a missing token", async () => {
    const { world } = await signedInTwice();

    await expect(world.service.getAuthenticatedUser(null)).resolves.toBeNull();
  });
});
