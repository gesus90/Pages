import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_LIFETIME_DAYS,
  SESSION_LIFETIME_SECONDS,
} from "@/backend/auth/SessionService";

import { SessionWorld } from "./session-service-world";

const START = new Date("2026-10-15T08:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const CHROME_ON_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function hashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("session lifetime constants", () => {
  it("keeps a session for fourteen days", () => {
    expect(SESSION_LIFETIME_DAYS).toBe(14);
    expect(SESSION_LIFETIME_SECONDS).toBe(14 * 24 * 60 * 60);
  });
});

describe("createSession", () => {
  it("returns a url-safe token and stores only its hash", async () => {
    const world = new SessionWorld();
    world.addPerson({ userId: "anna" });

    const token = await world.sessions.createSession("anna", CHROME_ON_WINDOWS);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(world.repository.sessions).toHaveLength(1);
    expect(world.repository.sessions[0]).toMatchObject({
      userId: "anna",
      tokenHash: hashOf(token),
      userAgent: CHROME_ON_WINDOWS,
    });
    expect(JSON.stringify(world.repository.sessions)).not.toContain(token);
  });

  it("issues a different token for every session", async () => {
    const world = new SessionWorld();
    world.addPerson({ userId: "anna" });

    const first = await world.sessions.createSession("anna");
    const second = await world.sessions.createSession("anna");

    expect(first).not.toBe(second);
    expect(world.repository.sessions.map((session) => session.id)).toEqual([
      expect.any(String),
      expect.any(String),
    ]);
    expect(world.repository.sessions[0]?.id).not.toBe(
      world.repository.sessions[1]?.id,
    );
  });

  it("records a missing user agent as unknown", async () => {
    const world = new SessionWorld();
    world.addPerson({ userId: "anna" });

    await world.sessions.createSession("anna", null);

    expect(world.repository.sessions[0]?.userAgent).toBeNull();
  });
});

describe("authenticate", () => {
  it("resolves the user behind a valid token and marks the session used", async () => {
    const world = new SessionWorld();
    world.addPerson({ userId: "anna", username: "anna" });
    const token = await world.sessions.createSession("anna");
    vi.setSystemTime(new Date(START.getTime() + 5 * 60_000));

    const user = await world.sessions.authenticate(token);

    expect(user).toMatchObject({ id: "anna", username: "anna" });
    expect(world.repository.sessions[0]?.lastUsedAt).toBe(Date.now());
  });

  it.each([null, ""])(
    "rejects the missing token %j without a lookup",
    async (token) => {
      const world = new SessionWorld();
      world.addPerson({ userId: "anna" });
      await world.sessions.createSession("anna");
      const lookup = vi.spyOn(world.repository, "findUserIdByTokenHash");

      await expect(world.sessions.authenticate(token)).resolves.toBeNull();
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  it("rejects an unknown token", async () => {
    const world = new SessionWorld();
    world.addPerson({ userId: "anna" });
    await world.sessions.createSession("anna");

    await expect(
      world.sessions.authenticate("not-a-session-token"),
    ).resolves.toBeNull();
  });

  it("rejects the session of a user who was deactivated since", async () => {
    const world = new SessionWorld();
    world.addPerson({ userId: "anna" });
    const token = await world.sessions.createSession("anna");
    world.accounts.setUserActive("anna", false);

    await expect(world.sessions.authenticate(token)).resolves.toBeNull();
    expect(world.repository.sessions[0]?.lastUsedAt).toBeNull();
  });

  it("rejects the session of a user who no longer exists", async () => {
    const world = new SessionWorld();
    world.addPerson({ userId: "anna" });
    const token = await world.sessions.createSession("anna");
    world.accounts.store.users.delete("anna");

    await expect(world.sessions.authenticate(token)).resolves.toBeNull();
  });

  it("accepts a session until its fourteen days are over", async () => {
    const world = new SessionWorld();
    world.addPerson({ userId: "anna" });
    const token = await world.sessions.createSession("anna");

    vi.setSystemTime(new Date(START.getTime() + 13 * DAY_MS));
    await expect(world.sessions.authenticate(token)).resolves.not.toBeNull();

    vi.setSystemTime(new Date(START.getTime() + 14 * DAY_MS + 1));
    await expect(world.sessions.authenticate(token)).resolves.toBeNull();
  });
});
