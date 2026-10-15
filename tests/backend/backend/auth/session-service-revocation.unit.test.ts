import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionWorld } from "./session-service-world";

const START = new Date("2026-10-15T08:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const CHROME_ON_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FIREFOX_ON_LINUX =
  "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0";

interface TwoBrowsers {
  readonly world: SessionWorld;
  readonly laptopToken: string;
  readonly phoneToken: string;
  readonly laptopSessionId: string;
  readonly phoneSessionId: string;
}

async function signInTwice(): Promise<TwoBrowsers> {
  const world = new SessionWorld();
  world.addPerson({ userId: "anna" });
  world.addPerson({ userId: "ben" });
  const laptopToken = await world.sessions.createSession(
    "anna",
    CHROME_ON_WINDOWS,
  );
  vi.setSystemTime(new Date(Date.now() + 60_000));
  const phoneToken = await world.sessions.createSession(
    "anna",
    FIREFOX_ON_LINUX,
  );
  const [laptop, phone] = world.repository.sessions;

  return {
    world,
    laptopToken,
    phoneToken,
    laptopSessionId: laptop?.id ?? "",
    phoneSessionId: phone?.id ?? "",
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getSessionSummaries", () => {
  it("lists the current session first with device information", async () => {
    const { world, laptopToken, phoneSessionId, laptopSessionId } =
      await signInTwice();

    const summaries = await world.sessions.getSessionSummaries(
      "anna",
      laptopToken,
    );

    expect(summaries.map((summary) => summary.id)).toEqual([
      laptopSessionId,
      phoneSessionId,
    ]);
    expect(summaries[0]).toMatchObject({
      browser: "Chrome 126",
      operatingSystem: "Windows",
      isCurrent: true,
    });
    expect(summaries[1]).toMatchObject({
      browser: "Firefox 127",
      operatingSystem: "Linux",
      isCurrent: false,
    });
  });

  it("marks no session as current without a token", async () => {
    const { world } = await signInTwice();

    const summaries = await world.sessions.getSessionSummaries("anna", null);

    expect(summaries).toHaveLength(2);
    expect(summaries.every((summary) => !summary.isCurrent)).toBe(true);
  });

  it("never lists the sessions of another user or expired sessions", async () => {
    const { world, laptopToken } = await signInTwice();
    await world.sessions.createSession("ben", CHROME_ON_WINDOWS);
    vi.setSystemTime(new Date(START.getTime() + 14 * DAY_MS + 120_000));
    await world.sessions.createSession("anna", FIREFOX_ON_LINUX);

    const summaries = await world.sessions.getSessionSummaries(
      "anna",
      laptopToken,
    );

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ browser: "Firefox 127" });
  });
});

describe("revokeSessionById", () => {
  it("revokes another session of the user so its token stops working", async () => {
    const { world, laptopToken, phoneToken, phoneSessionId } =
      await signInTwice();

    const revoked = await world.sessions.revokeSessionById(
      "anna",
      phoneSessionId,
      laptopToken,
    );

    expect(revoked).toBe(true);
    await expect(world.sessions.authenticate(phoneToken)).resolves.toBeNull();
    await expect(
      world.sessions.authenticate(laptopToken),
    ).resolves.not.toBeNull();
  });

  it("never revokes the session of the requesting browser", async () => {
    const { world, laptopToken, laptopSessionId } = await signInTwice();

    const revoked = await world.sessions.revokeSessionById(
      "anna",
      laptopSessionId,
      laptopToken,
    );

    expect(revoked).toBe(false);
    await expect(
      world.sessions.authenticate(laptopToken),
    ).resolves.not.toBeNull();
  });

  it("reports an unknown session identifier without changes", async () => {
    const { world, laptopToken } = await signInTwice();

    const revoked = await world.sessions.revokeSessionById(
      "anna",
      "missing-session",
      laptopToken,
    );

    expect(revoked).toBe(false);
    expect(world.repository.sessions).toHaveLength(2);
  });

  it("does not revoke the session of another user", async () => {
    const { world, laptopToken, phoneSessionId, phoneToken } =
      await signInTwice();
    const benToken = await world.sessions.createSession("ben");

    const revoked = await world.sessions.revokeSessionById(
      "ben",
      phoneSessionId,
      benToken,
    );

    expect(revoked).toBe(false);
    await expect(
      world.sessions.authenticate(phoneToken),
    ).resolves.not.toBeNull();
    expect(laptopToken).not.toBe(benToken);
  });

  it("revokes any own session when the request has no token", async () => {
    const { world, laptopToken, laptopSessionId } = await signInTwice();

    const revoked = await world.sessions.revokeSessionById(
      "anna",
      laptopSessionId,
      null,
    );

    expect(revoked).toBe(true);
    await expect(world.sessions.authenticate(laptopToken)).resolves.toBeNull();
  });
});

describe("revoking several sessions", () => {
  it("keeps only the current session when revoking the others", async () => {
    const { world, laptopToken, phoneToken } = await signInTwice();
    const benToken = await world.sessions.createSession("ben");

    await world.sessions.revokeOtherSessions("anna", laptopToken);

    await expect(
      world.sessions.authenticate(laptopToken),
    ).resolves.not.toBeNull();
    await expect(world.sessions.authenticate(phoneToken)).resolves.toBeNull();
    await expect(world.sessions.authenticate(benToken)).resolves.not.toBeNull();
  });

  it("removes every session of the user, including the current one", async () => {
    const { world, laptopToken, phoneToken } = await signInTwice();
    const benToken = await world.sessions.createSession("ben");

    await world.sessions.revokeAllSessions("anna");

    await expect(world.sessions.authenticate(laptopToken)).resolves.toBeNull();
    await expect(world.sessions.authenticate(phoneToken)).resolves.toBeNull();
    await expect(world.sessions.authenticate(benToken)).resolves.not.toBeNull();
  });
});

describe("revoke and expiry cleanup", () => {
  it("invalidates exactly the session of the token", async () => {
    const { world, laptopToken, phoneToken } = await signInTwice();

    await world.sessions.revoke(laptopToken);

    await expect(world.sessions.authenticate(laptopToken)).resolves.toBeNull();
    await expect(
      world.sessions.authenticate(phoneToken),
    ).resolves.not.toBeNull();
  });

  it.each([null, ""])("ignores the missing token %j", async (token) => {
    const { world } = await signInTwice();
    const deletion = vi.spyOn(world.repository, "deleteByTokenHash");

    await world.sessions.revoke(token);

    expect(deletion).not.toHaveBeenCalled();
    expect(world.repository.sessions).toHaveLength(2);
  });

  it("removes only the sessions that have expired", async () => {
    const { world } = await signInTwice();
    vi.setSystemTime(new Date(START.getTime() + 14 * DAY_MS + 120_000));
    const freshToken = await world.sessions.createSession("ben");

    await world.sessions.removeExpiredSessions();

    expect(world.repository.sessions).toHaveLength(1);
    await expect(
      world.sessions.authenticate(freshToken),
    ).resolves.not.toBeNull();
  });
});
